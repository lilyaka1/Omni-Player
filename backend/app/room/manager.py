"""
RoomManager — оркестратор broadcast-потоков для всех комнат.

Архитектура (упрощённая):
   1. При добавлении трека в комнату фоновая таска `prefetch_track_file`
      скачивает аудио в backend/downloads/{source}_{src_id}.mp3 и пишет
      ЛОКАЛЬНЫЙ путь в RoomTrack.stream_url.
   2. broadcast_loop читает RoomTrack.now_playing → берёт локальный файл →
      запускает ffmpeg → льёт чанки слушателям.
   3. После трека: проверяет ready voice inserts → проигрывает их по очереди
      (через тот же ffmpeg+RoomState) → advance_track → следующий трек.
"""
from __future__ import annotations

import asyncio
import os
import time as _t
from pathlib import Path
from typing import Dict, Optional

from app.room.ffmpeg import stream_ffmpeg
from app.room.queue import advance_track, peek_next_track
from app.room.room_state import RoomState
from app.voice_inserts.queue import build_room_voice_sequence, get_room_voice_sequence_signature

# Куда складываем локальные mp3
_BACKEND_DIR = Path(__file__).resolve().parent.parent.parent
_DOWNLOADS_DIR = _BACKEND_DIR / "downloads"
_DOWNLOADS_DIR.mkdir(parents=True, exist_ok=True)


def _file_stem(source: str, source_track_id: str) -> str:
    safe = "".join(c for c in (source_track_id or "") if c.isalnum() or c in "_-")
    return f"{source or 'src'}_{safe or 'unknown'}"


def _is_local_file(path: Optional[str]) -> bool:
    if not path:
        return False
    if path.startswith(("http://", "https://")):
        return False
    return os.path.isfile(path)


class RoomManager:
    """Менеджер broadcast-потоков для всех комнат."""

    def __init__(self):
        self.broadcasts: Dict[int, RoomState] = {}
        self._last_activity: Dict[int, float] = {}
        # ID треков, для которых сейчас идёт скачивание (антидубликат).
        self._downloading: set[int] = set()
        # Lock to prevent double-broadcast-start from concurrent requests.
        self._start_locks: Dict[int, asyncio.Lock] = {}
        self._locks_lock = asyncio.Lock()

    async def _get_start_lock(self, room_id: int) -> asyncio.Lock:
        """Get or create a per-room lock for broadcast start."""
        async with self._locks_lock:
            if room_id not in self._start_locks:
                self._start_locks[room_id] = asyncio.Lock()
            return self._start_locks[room_id]

    # ──────────────────────────────────────────────────────────────────── #
    #  Public API                                                          #
    # ──────────────────────────────────────────────────────────────────── #

    def get_or_create(self, room_id: int) -> RoomState:
        if room_id not in self.broadcasts:
            self.broadcasts[room_id] = RoomState(room_id)
        return self.broadcasts[room_id]

    def is_live(self, room_id: int) -> bool:
        bc = self.broadcasts.get(room_id)
        return bc is not None and bc.running

    async def start_room(self, room_id: int, db_session_factory, soundcloud_client):
        lock = await self._get_start_lock(room_id)
        async with lock:
            bc = self.get_or_create(room_id)
            if bc.running:
                print(f"📻 Room {room_id} broadcast already running")
                return

            asyncio.create_task(
                self.prefetch_room_files(room_id, db_session_factory, soundcloud_client)
            )

            # Pre-playback hook: фиксируем voice inserts до первого запуска loop.
            try:
                await self._prepare_room_voice_sequence(bc, room_id)
            except Exception as e:
                print(f"⚠️ Room {room_id}: voice inserts pre-playback hook failed: {e}")

            print("[ROOM START] room_id =", room_id)
            print("[ROOM START] inserts =", len(bc.voice_insert_queue))

            # Параллельно прогреваем общий TTS-кэш и фоном докачиваем файлы для всех треков комнаты.
            try:
                from app.voice_inserts.queue import prewarm_room
                asyncio.create_task(prewarm_room(room_id))
            except Exception as e:
                print(f"⚠️ Room {room_id}: voice cache prewarm not started: {e}")

            bc.running = True
            bc.task = asyncio.create_task(
                self._broadcast_loop(bc, room_id, db_session_factory, soundcloud_client)
            )
            self._last_activity[room_id] = _t.monotonic()
            print(f"🎙️ Room {room_id}: broadcast STARTED")

    async def stop_room(self, room_id: int):
        bc = self.broadcasts.get(room_id)
        if not bc:
            return
        bc.running = False
        if bc.task:
            bc.task.cancel()
            try:
                await bc.task
            except (asyncio.CancelledError, Exception):
                pass
        await bc.broadcast_end()

        self.broadcasts.pop(room_id, None)
        self._last_activity.pop(room_id, None)
        print(f"⏹️ Room {room_id}: broadcast STOPPED and cleaned up")

    # ──────────────────────────────────────────────────────────────────── #
    #  Prefetch                                                            #
    # ──────────────────────────────────────────────────────────────────── #

    async def prefetch_track_file(
        self,
        track_id: int,
        source: str,
        source_track_id: str,
        db_session_factory,
        soundcloud_client,
    ) -> Optional[str]:
        """
        Скачивает трек в локальный файл (если ещё не скачан) и пишет путь в
        RoomTrack.stream_url. Возвращает абсолютный путь к файлу или None.
        """
        if not source_track_id:
            return None
        if track_id in self._downloading:
            return None

        from app.database.models import RoomTrack

        # Проверяем БД — может, файл уже на диске.
        def _read_existing():
            db = db_session_factory()
            try:
                t = db.query(RoomTrack).filter(RoomTrack.id == track_id).first()
                if not t:
                    return None
                return {
                    "stream_url": t.stream_url,
                    "thumbnail": t.thumbnail,
                }
            finally:
                db.close()

        existing = await asyncio.to_thread(_read_existing)
        if not existing:
            return None
        if _is_local_file(existing["stream_url"]):
            return existing["stream_url"]

        # Достаём page URL — для SC это `source_track_id` (либо чистый ID,
        # либо webpage URL — `download_to_file` приведёт к нужному виду).
        track_url = source_track_id

        self._downloading.add(track_id)
        try:
            stem = _file_stem(source, source_track_id)
            target_dir = _DOWNLOADS_DIR
            print(f"⬇️ [prefetch] track {track_id}: downloading → {stem}.mp3")
            t0 = _t.perf_counter()
            info = await soundcloud_client.download_to_file(
                track_url, target_dir, stem
            )
            elapsed = (_t.perf_counter() - t0) * 1000
            if not info or not info.get("path"):
                print(f"❌ [prefetch] track {track_id}: download failed (+{elapsed:.0f}ms)")
                return None

            local_path = info["path"]
            new_thumb = info.get("thumbnail")

            # ── Валидация скачанного файла ──
            try:
                from app.room.ffmpeg import validate_audio_file
                v = validate_audio_file(local_path, timeout=15)
                if not v.get("ok"):
                    print(f"❌ [prefetch] track={track_id}: audio broken after download — {v.get('error')}")
                    # Не сохраняем битый путь
                    return None
                print(f"✅ [prefetch] track={track_id}: audio valid ({v.get('duration', '?')}s {v.get('codec')})")
            except Exception as ve:
                print(f"⚠️ [prefetch] track={track_id}: validation error: {ve}")

            def _save():
                db = db_session_factory()
                try:
                    t = db.query(RoomTrack).filter(RoomTrack.id == track_id).first()
                    if not t:
                        return None
                    saved_thumb = None
                    if new_thumb and not t.thumbnail:
                        t.thumbnail = new_thumb
                        saved_thumb = new_thumb
                    # IMPORTANT: write local path into stream_url so stream endpoint uses it
                    t.stream_url = local_path
                    room_id = t.room_id
                    db.commit()
                    # Create/update the Track + TrackAsset(status='ready') cache record
                    # — the canonical "downloaded" marker the stream endpoint prefers.
                    try:
                        from app.playback.controller import ensure_track_and_asset
                        ensure_track_and_asset(db, t, local_path, info)
                    except Exception as ae:
                        print(f"⚠️ [prefetch] track {track_id}: asset record failed: {ae}")
                    return {"room_id": room_id, "thumb": saved_thumb}
                finally:
                    db.close()

            saved = await asyncio.to_thread(_save)
            print(f"✅ [prefetch] track {track_id} cached locally (+{elapsed:.0f}ms)")
            if saved and saved["thumb"]:
                await self._broadcast_thumbnail(saved["room_id"], track_id, saved["thumb"])
            return local_path
        except Exception as e:
            print(f"❌ [prefetch] track {track_id} error: {e}")
            return None
        finally:
            self._downloading.discard(track_id)

    async def prefetch_room_files(
        self, room_id: int, db_session_factory, soundcloud_client
    ):
        """Скачивает локальные mp3 для ВСЕХ треков комнаты последовательно."""
        from app.database.models import RoomTrack

        def _list_tracks():
            db = db_session_factory()
            try:
                rows = (
                    db.query(RoomTrack)
                    .filter(RoomTrack.room_id == room_id)
                    .order_by(RoomTrack.order)
                    .all()
                )
                return [
                    (t.id, t.source, t.source_track_id, t.stream_url) for t in rows
                ]
            finally:
                db.close()

        tracks = await asyncio.to_thread(_list_tracks)
        if not tracks:
            return

        print(f"📥 [prefetch] room {room_id}: ensuring {len(tracks)} local files…")
        for track_id, source, source_track_id, stream_url in tracks:
            if _is_local_file(stream_url):
                continue
            if not source_track_id:
                continue
            await self.prefetch_track_file(
                track_id, source, source_track_id, db_session_factory, soundcloud_client
            )
            await asyncio.sleep(0.5)
        print(f"✅ [prefetch] room {room_id}: done")

    # ──────────────────────────────────────────────────────────────────── #
    #  Broadcast loop                                                      #
    # ──────────────────────────────────────────────────────────────────── #

    async def _prepare_room_voice_sequence(self, bc: RoomState, room_id: int):
        voice_sequence = await build_room_voice_sequence(room_id)
        bc.set_voice_insert_queue(
            voice_sequence,
            get_room_voice_sequence_signature(room_id),
        )
        return voice_sequence

    async def _broadcast_loop(
        self,
        bc: RoomState,
        room_id: int,
        db_session_factory,
        soundcloud_client,
    ):
        from app.database.models import Room, RoomTrack

        def _fetch_playback_state():
            db = db_session_factory()
            try:
                # ── FIX: was requiring is_playing + now_playing_track_id separately.
                # MVP: if brоadcast is running, let it work. Rely on now_playing_track_id only.
                room = db.query(Room).filter(Room.id == room_id).first()
                if not room or not room.now_playing_track_id:
                    return None
                t = (
                    db.query(RoomTrack)
                    .filter(RoomTrack.id == room.now_playing_track_id)
                    .first()
                )
                if not t:
                    return None
                stream_url = t.stream_url

                # ── FIX: resolve pending local-upload → direct FILE PATH (NO /api/ redirect) ──
                # Radio-mode rule: stream_url MUST be absolute file path or http(s) URL.
                # Using /api/ URL causes redirect loops. Always resolve to local_file_path.
                if stream_url and (stream_url == "pending://local-upload" or stream_url.startswith("local-upload://")):
                    from app.database.models import Track, SourceEnum
                    src_id = t.source_track_id or ""
                    resolved_path = None
                    if src_id.isdigit():
                        orig = db.query(Track).filter(Track.id == int(src_id)).first()
                        if orig and orig.local_file_path:
                            resolved_path = orig.local_file_path
                    if not resolved_path:
                        # вторичный поиск по title если source_track_id не число
                        orig = db.query(Track).filter(
                            Track.source == SourceEnum.LOCAL,
                            Track.title == t.title,
                            Track.artist == t.artist,
                        ).first()
                        if orig and orig.local_file_path:
                            resolved_path = orig.local_file_path
                    if resolved_path:
                        stream_url = resolved_path
                        # DO NOT persist resolved_path into DB here; leave RoomTrack.stream_url
                        # unchanged to avoid giving playback a direct file path.

                return {
                    "track_id": t.id,
                    "title": t.title,
                    "artist": t.artist,
                    "stream_url": stream_url,
                    "source": t.source,
                    "source_track_id": t.source_track_id,
                    "thumbnail": t.thumbnail,
                }
            finally:
                db.close()

        def _count_remaining(current_track_id: int) -> int:
            db = db_session_factory()
            try:
                cur = db.query(RoomTrack).filter(RoomTrack.id == current_track_id).first()
                if not cur:
                    return 0
                if cur.order is not None:
                    return (
                        db.query(RoomTrack)
                        .filter(RoomTrack.room_id == room_id, RoomTrack.order >= cur.order)
                        .count()
                    )
                return (
                    db.query(RoomTrack)
                    .filter(RoomTrack.room_id == room_id, RoomTrack.id >= current_track_id)
                    .count()
                )
            finally:
                db.close()

        print(f"🔄 Room {room_id}: broadcast loop started")
        last_track_id = None
        consecutive_skips = 0
        _MAX_SKIP_BEFORE_STALL_RESET = 5  # после 5 пропусков подряд — гасим is_playing

        while bc.running:
            try:
                state = await asyncio.to_thread(_fetch_playback_state)
                if state is None:
                    await asyncio.sleep(2)
                    continue

                track_id = state["track_id"]
                if track_id == last_track_id:
                    await asyncio.sleep(2)
                    continue

                last_track_id = track_id
                bc.current_track_id = track_id
                bc.current_track_title = f"{state['artist']} - {state['title']}"
                bc.skip_event.clear()

                print("[TRACK START]", track_id)

                # voice prewarm если очередь к концу
                try:
                    remaining = await asyncio.to_thread(_count_remaining, track_id)
                    if remaining <= 5:
                        from app.voice_inserts.queue import on_queue_change
                        asyncio.create_task(on_queue_change(room_id, remaining))
                except Exception as e:
                    print(f"⚠️ [voice] queue warmup check failed: {e}")

                # Гарантируем, что у нас локальный файл
                local_path = state["stream_url"]
                if not _is_local_file(local_path):
                    print(f"⏬ [room] track {track_id}: no local file, downloading on-the-fly")
                    local_path = await self.prefetch_track_file(
                        track_id,
                        state["source"],
                        state["source_track_id"],
                        db_session_factory,
                        soundcloud_client,
                    )

                if not local_path:
                    print(f"❌ Room {room_id}: cannot get file for track {track_id}, skipping")
                    consecutive_skips += 1
                    if consecutive_skips >= _MAX_SKIP_BEFORE_STALL_RESET:
                        print(f"⚠️ Room {room_id}: {consecutive_skips} consecutive skips — stopping broadcast")
                        bc.running = False
                        break
                    advanced = await advance_track(room_id, db_session_factory)
                    if not advanced:
                        bc.running = False
                        break
                    last_track_id = -1
                    await asyncio.sleep(1)
                    continue

                # Параллельно качаем следующий трек
                asyncio.create_task(
                    self._prefetch_next(room_id, db_session_factory, soundcloud_client)
                )

                t0 = _t.perf_counter()
                print(f"\n⏱  [room] room {room_id}: PLAY '{bc.current_track_title}'")
                result = await stream_ffmpeg(bc, local_path)
                elapsed = (_t.perf_counter() - t0) * 1000
                print(f"⏱  [room] room {room_id}: track ended ({result}, +{elapsed:.0f}ms)")

                if result == "skipped":
                    await asyncio.sleep(0.2)
                    continue

                if not result or result == "expired":
                    # Файл битый/исчез — обнулим путь, попробуем перекачать в следующей итерации
                    def _clear_url():
                        db = db_session_factory()
                        try:
                            t = db.query(RoomTrack).filter(RoomTrack.id == track_id).first()
                            if t:
                                t.stream_url = None
                                db.commit()
                        finally:
                            db.close()
                    await asyncio.to_thread(_clear_url)
                    if not result:  # bc.running == False
                        break
                    last_track_id = -1
                    await asyncio.sleep(1)
                    continue

                # Трек закончился штатно → проигрываем готовые voice inserts.
                print("[TRACK END]", track_id)
                await self._play_voice_inserts(bc, room_id, track_id)

                advanced = await advance_track(room_id, db_session_factory)
                if not advanced:
                    bc.running = False
                    break

                await asyncio.sleep(0.2)

            except asyncio.CancelledError:
                break
            except Exception as e:
                print(f"❌ Room {room_id} broadcast error: {e}")
                import traceback; traceback.print_exc()
                await asyncio.sleep(3)

        bc.running = False
        await bc.broadcast_end()
        print(f"🔇 Room {room_id}: broadcast loop ended")

    # ──────────────────────────────────────────────────────────────────── #
    #  Voice inserts playback                                              #
    # ──────────────────────────────────────────────────────────────────── #

    async def _play_voice_inserts(self, bc: RoomState, room_id: int, just_played_track_id: int):
        """Между треками — проигрываем уже подготовленные inserts."""
        inserts = bc.consume_voice_inserts(just_played_track_id)
        if not inserts:
            return

        print("[INSERT QUEUE SIZE]", len(inserts))
        print(f"🗣️  [voice] room {room_id}: playing {len(inserts)} inserts")
        for ins in inserts:
            audio_path = getattr(ins, "audio_path", None) or (
                ins.get("audio_path") if isinstance(ins, dict) else None
            )
            insert_id = getattr(ins, "id", None) or (
                ins.get("id") if isinstance(ins, dict) else None
            )
            print("[INSERT PLAY]", insert_id)
            if not audio_path or not os.path.isfile(audio_path):
                print(f"⚠️ [voice] insert {insert_id}: file missing ({audio_path})")
                continue

            try:
                await self._broadcast_insert_event(room_id, insert_id, "playing")
                result = await stream_ffmpeg(bc, audio_path)
                if result is False:
                    return
                if insert_id is not None:
                    try:
                        from app.voice_inserts.queue import mark_insert_played
                        await mark_insert_played(insert_id)
                    except Exception as e:
                        print(f"⚠️ [voice] mark_insert_played({insert_id}) failed: {e}")
                await self._broadcast_insert_event(room_id, insert_id, "played")
            except Exception as e:
                print(f"⚠️ [voice] insert {insert_id} playback error: {e}")

    # ──────────────────────────────────────────────────────────────────── #
    #  Helpers                                                             #
    # ──────────────────────────────────────────────────────────────────── #

    async def _prefetch_next(self, room_id: int, db_session_factory, soundcloud_client):
        try:
            self._last_activity[room_id] = _t.monotonic()
            await asyncio.sleep(2)
            nxt = await peek_next_track(room_id, db_session_factory)
            if not nxt:
                return
            if _is_local_file(nxt.get("stream_url")):
                return
            await self.prefetch_track_file(
                nxt["id"],
                nxt.get("source", "soundcloud"),
                nxt.get("source_track_id"),
                db_session_factory,
                soundcloud_client,
            )
        except Exception as e:
            print(f"⚠️ [prefetch_next] {e}")

    async def _broadcast_thumbnail(self, room_id: int, track_id: int, thumbnail: str):
        import json
        try:
            from app.websocket.manager import manager as _mgr
            await _mgr.broadcast(room_id, json.dumps({
                "type": "thumbnail_updated",
                "track_id": track_id,
                "thumbnail": thumbnail,
            }))
        except Exception as e:
            print(f"⚠️ thumbnail broadcast failed: {e}")

    async def _broadcast_insert_event(self, room_id: int, insert_id, status: str):
        import json
        try:
            from app.websocket.manager import manager as _mgr
            await _mgr.broadcast(room_id, json.dumps({
                "type": "voice_insert_status",
                "insert_id": insert_id,
                "status": status,
            }))
        except Exception:
            pass


room_manager = RoomManager()
