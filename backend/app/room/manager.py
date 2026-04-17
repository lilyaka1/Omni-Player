"""
RoomManager — оркестратор broadcast-потоков для всех комнат.
"""
import asyncio
import time as _t
from typing import Dict

from app.room.room_state import RoomState
from app.room.ffmpeg import stream_ffmpeg
from app.room.queue import advance_track, peek_next_track


class RoomManager:
    """Менеджер broadcast-потоков для всех комнат."""

    def __init__(self):
        self.broadcasts: Dict[int, RoomState] = {}
        self._url_fresh_until: Dict[int, float] = {}
        # Трекинг последней активности комнаты для автоочистки
        self._last_activity: Dict[int, float] = {}

    # ------------------------------------------------------------------ #
    #  Публичный API                                                       #
    # ------------------------------------------------------------------ #

    def get_or_create(self, room_id: int) -> RoomState:
        if room_id not in self.broadcasts:
            self.broadcasts[room_id] = RoomState(room_id)
        return self.broadcasts[room_id]

    def is_live(self, room_id: int) -> bool:
        bc = self.broadcasts.get(room_id)
        return bc is not None and bc.running

    async def start_room(self, room_id: int, db_session_factory, soundcloud_client):
        """Запустить broadcast для комнаты."""
        bc: RoomState = self.get_or_create(room_id)
        if bc.running:
            print(f"📻 Room {room_id} broadcast already running")
            return

        bc.running = True
        bc.task = asyncio.create_task(
            self._broadcast_loop(bc, room_id, db_session_factory, soundcloud_client)
        )
        # Немедленно обновляем все URL и запускаем периодический refresh
        asyncio.create_task(
            self.refresh_room_urls(room_id, db_session_factory, soundcloud_client)
        )
        bc._url_refresh_task = asyncio.create_task(
            self._url_refresh_loop(room_id, db_session_factory, soundcloud_client)
        )
        # Трекаем активность
        self._last_activity[room_id] = _t.monotonic()
        print(f"🎙️ Room {room_id}: broadcast STARTED")

    async def stop_room(self, room_id: int):
        """Остановить broadcast комнаты."""
        bc = self.broadcasts.get(room_id)
        if not bc:
            return
        bc.running = False
        # Отменяем периодический refresh
        url_task = getattr(bc, '_url_refresh_task', None)
        if url_task:
            url_task.cancel()
            try:
                await url_task
            except (asyncio.CancelledError, Exception):
                pass
        if bc.task:
            bc.task.cancel()
            try:
                await bc.task
            except (asyncio.CancelledError, Exception):
                pass
        await bc.broadcast_end()
        
        # Убираем из памяти чтобы не расти бесконечно
        if room_id in self.broadcasts:
            del self.broadcasts[room_id]
        if room_id in self._last_activity:
            del self._last_activity[room_id]
        
        print(f"⏹️ Room {room_id}: broadcast STOPPED and cleaned up")

    async def prefetch_track_url(self, track_id: int, source_track_id: str,
                                  db_session_factory, soundcloud_client):
        """
        Фоновая предзагрузка stream URL при добавлении трека в очередь.
        Когда admin нажмёт Play — URL уже закеширован.
        """
        _pf_t0 = _t.perf_counter()
        print(f"🔥 [prefetch] START track {track_id}")
        try:
            info = await soundcloud_client.get_track_info(source_track_id)
            url = info.get("url") if isinstance(info, dict) else info
            elapsed = (_t.perf_counter() - _pf_t0) * 1000
            print(f"🔥 [prefetch] +{elapsed:.0f}ms yt-dlp done, url={'OK' if url else 'NONE'}")

            if not url:
                return

            new_thumb = info.get('thumbnail') if isinstance(info, dict) else None

            def _save_prefetch():
                from app.database.models import RoomTrack
                db = db_session_factory()
                try:
                    track = db.query(RoomTrack).filter(RoomTrack.id == track_id).first()
                    if not track:
                        return None
                    track.stream_url = url
                    saved_thumb = None
                    if new_thumb and not track.thumbnail:
                        track.thumbnail = new_thumb
                        saved_thumb = new_thumb
                    title = track.title
                    room_id = track.room_id
                    db.commit()
                    return {"title": title, "room_id": room_id, "thumb": saved_thumb}
                finally:
                    db.close()

            result = await asyncio.to_thread(_save_prefetch)
            if not result:
                return

            elapsed = (_t.perf_counter() - _pf_t0) * 1000
            print(f"✅ [prefetch] +{elapsed:.0f}ms CACHED '{result['title']}'")

            if result["thumb"]:
                print(f"🖼️ [prefetch] thumbnail saved for track {track_id}")
                await self._broadcast_thumbnail(result["room_id"], track_id, result["thumb"])

            import time
            self._url_fresh_until[track_id] = time.monotonic() + 3600 * 4  # 4 часа

        except Exception as e:
            elapsed = (_t.perf_counter() - _pf_t0) * 1000
            print(f"⚠️ [prefetch] +{elapsed:.0f}ms FAILED track {track_id}: {e}")

    async def refresh_room_urls(self, room_id: int, db_session_factory, soundcloud_client):
        """
        Обновить stream_url для ВСЕХ треков комнаты.
        Вызывается при старте стрима и периодически каждые URL_REFRESH_INTERVAL часов.
        yt-dlp вызывается последовательно с паузой 1с — чтобы не получить ban от SoundCloud.
        """
        from app.database.models import RoomTrack

        def _get_tracks():
            db = db_session_factory()
            try:
                return [
                    (t.id, t.source_track_id, t.source)
                    for t in db.query(RoomTrack)
                    .filter(RoomTrack.room_id == room_id)
                    .order_by(RoomTrack.order)
                    .all()
                ]
            finally:
                db.close()

        tracks = await asyncio.to_thread(_get_tracks)
        if not tracks:
            return

        print(f"🔄 [url_refresh] room {room_id}: refreshing {len(tracks)} tracks...")

        for track_id, source_track_id, source in tracks:
            if source not in ('soundcloud', 'youtube') or not source_track_id:
                continue

            # Пропускаем трек если URL свежий (не истёк по нашему кешу)
            if _t.monotonic() < self._url_fresh_until.get(track_id, 0):
                print(f"⏩ [url_refresh] track {track_id} still fresh, skipping")
                continue

            try:
                info = await soundcloud_client.get_track_info(source_track_id)
                url = info.get('url') if isinstance(info, dict) else info
                if not url:
                    print(f"⚠️ [url_refresh] no URL for track {track_id}")
                    continue

                def _save(tid=track_id, u=url):
                    db = db_session_factory()
                    try:
                        t = db.query(RoomTrack).filter(RoomTrack.id == tid).first()
                        if t:
                            t.stream_url = u
                            db.commit()
                    finally:
                        db.close()

                await asyncio.to_thread(_save)
                self._url_fresh_until[track_id] = _t.monotonic() + 3600 * 4  # 4 часа
                print(f"✅ [url_refresh] track {track_id} refreshed")

            except Exception as e:
                print(f"⚠️ [url_refresh] track {track_id} failed: {e}")

            # Пауза между треками — не ддосим SoundCloud
            await asyncio.sleep(1.5)

        print(f"✅ [url_refresh] room {room_id}: done")

    async def _url_refresh_loop(self, room_id: int, db_session_factory, soundcloud_client):
        """
        Фоновая задача: повторно обновляет все URL комнаты каждые 4 часа.
        SoundCloud CDN (CloudFront) URL живут ~6 часов — обновляем с запасом.
        """
        URL_REFRESH_INTERVAL = 4 * 3600  # 4 часа в секундах

        while True:
            try:
                await asyncio.sleep(URL_REFRESH_INTERVAL)
                bc = self.broadcasts.get(room_id)
                if not bc or not bc.running:
                    print(f"⏹️ [url_refresh] room {room_id} stopped, exiting loop")
                    break
                print(f"🕒 [url_refresh] scheduled refresh for room {room_id}")
                await self.refresh_room_urls(room_id, db_session_factory, soundcloud_client)
            except asyncio.CancelledError:
                break
            except Exception as e:
                print(f"⚠️ [url_refresh] loop error room {room_id}: {e}")
                await asyncio.sleep(60)  # через минуту попробуем снова

    # ------------------------------------------------------------------ #
    #  Helpers                                                             #
    # ------------------------------------------------------------------ #

    @staticmethod
    def _is_url_expired(url: str) -> bool:
        """Проверяет, не истёк ли CloudFront signed URL (SoundCloud CDN)."""
        if not url or 'sndcdn.com' not in url:
            return False
        try:
            import urllib.parse, base64 as _b64, json as _json, time as _time
            qs = urllib.parse.parse_qs(urllib.parse.urlparse(url).query)
            policy_b64 = qs.get('Policy', [None])[0]
            if not policy_b64:
                return False
            # CloudFront использует URL-safe base64: - → +, _ → /
            policy_b64 = policy_b64.replace('-', '+').replace('_', '/')
            policy_b64 += '=' * (-len(policy_b64) % 4)
            policy = _json.loads(_b64.b64decode(policy_b64))
            expiry = policy['Statement'][0]['Condition']['DateLessThan']['AWS:EpochTime']
            # Считаем истёкшим если осталось менее 60 сек
            return _time.time() > expiry - 60
        except Exception:
            return False

    # ------------------------------------------------------------------ #
    #  Broadcast loop                                                      #
    # ------------------------------------------------------------------ #

    async def _broadcast_loop(self, bc: RoomState, room_id: int,
                               db_session_factory, soundcloud_client):
        """Главный цикл: берёт треки, тянет аудио, льёт слушателям."""
        from app.database.models import Room, RoomTrack

        # ── Синхронные DB-хелперы (выполняются в потоке, не блокируют event loop) ──

        def _fetch_playback_state():
            """Читает состояние воспроизведения из БД. Запускается в потоке."""
            db = db_session_factory()
            try:
                room = db.query(Room).filter(Room.id == room_id).first()
                if not room or not room.is_playing:
                    return None
                track_id = room.now_playing_track_id
                if not track_id:
                    return None
                track = db.query(RoomTrack).filter(RoomTrack.id == track_id).first()
                if not track:
                    return None
                return {
                    "track_id": track.id,
                    "title": track.title,
                    "artist": track.artist,
                    "stream_url": track.stream_url,
                    "source_track_id": track.source_track_id,
                    "thumbnail": track.thumbnail,
                }
            finally:
                db.close()

        def _save_stream_url(track_id, stream_url, new_thumbnail=None):
            """Сохраняет stream_url в БД. Запускается в потоке."""
            db = db_session_factory()
            try:
                t = db.query(RoomTrack).filter(RoomTrack.id == track_id).first()
                if not t:
                    return None
                t.stream_url = stream_url
                saved_thumb = None
                if new_thumbnail and not t.thumbnail:
                    t.thumbnail = new_thumbnail
                    saved_thumb = new_thumbnail
                db.commit()
                return saved_thumb  # None если thumbnail не обновлён
            finally:
                db.close()

        def _clear_stream_url(track_id):
            """Сбрасывает stream_url (URL протух). Запускается в потоке."""
            db = db_session_factory()
            try:
                t = db.query(RoomTrack).filter(RoomTrack.id == track_id).first()
                if t:
                    t.stream_url = None
                    db.commit()
            finally:
                db.close()

        # ────────────────────────────────────────────────────────────────────────

        print(f"🔄 Room {room_id}: broadcast loop started")
        last_track_id = None

        while bc.running:
            try:
                # Читаем состояние комнаты В ПОТОКЕ (не блокируем event loop)
                state = await asyncio.to_thread(_fetch_playback_state)

                if state is None:
                    await asyncio.sleep(2)
                    continue

                track_id = state["track_id"]

                # Ждём смены трека (не стримим одно и то же)
                if track_id == last_track_id:
                    await asyncio.sleep(3)
                    continue

                last_track_id = track_id
                bc.current_track_id = track_id
                bc.current_track_title = f"{state['artist']} - {state['title']}"
                bc.skip_event.clear()

                _loop_t0 = _t.perf_counter()
                print(f"\n⏱  [room] room {room_id}: START '{bc.current_track_title}'")

                # Получаем stream URL
                stream_url = state["stream_url"] or None

                # Проверяем не истёк ли CloudFront URL до запуска ffmpeg
                url_expired = self._is_url_expired(stream_url)
                needs_refresh = not stream_url or url_expired

                if url_expired:
                    elapsed = (_t.perf_counter() - _loop_t0) * 1000
                    print(f"⏱  [room] +{elapsed:.0f}ms ⚠️ CloudFront URL expired, refreshing...")

                if not needs_refresh:
                    fresh_until = self._url_fresh_until.get(track_id, 0)
                    elapsed = (_t.perf_counter() - _loop_t0) * 1000
                    if _t.monotonic() < fresh_until:
                        print(f"⏱  [room] +{elapsed:.0f}ms ⚡ URL fresh, skipping HEAD")
                    else:
                        print(f"⏱  [room] +{elapsed:.0f}ms ⚡ streaming directly")

                if needs_refresh and state["source_track_id"]:
                    elapsed = (_t.perf_counter() - _loop_t0) * 1000
                    print(f"⏱  [room] +{elapsed:.0f}ms calling yt-dlp...")
                    info = await soundcloud_client.get_track_info(state["source_track_id"])
                    elapsed = (_t.perf_counter() - _loop_t0) * 1000
                    print(f"⏱  [room] +{elapsed:.0f}ms yt-dlp done")

                    stream_url = info.get("url") if isinstance(info, dict) else info

                    if stream_url:
                        new_thumb = info.get("thumbnail") if isinstance(info, dict) else None
                        # Сохраняем URL в потоке
                        saved_thumb = await asyncio.to_thread(
                            _save_stream_url, track_id, stream_url, new_thumb
                        )
                        if saved_thumb:
                            print(f"🖼️ [room] thumbnail saved for track {track_id}")
                            await self._broadcast_thumbnail(room_id, track_id, saved_thumb)

                if not stream_url:
                    print(f"❌ Room {room_id}: no stream URL for track {track_id}, skipping")
                    await asyncio.sleep(3)
                    continue

                # Стримим трек
                elapsed = (_t.perf_counter() - _loop_t0) * 1000
                print(f"⏱  [room] +{elapsed:.0f}ms starting ffmpeg...")
                
                # Запускаем prefetch следующего трека в фоне (чтобы не было задержки)
                asyncio.create_task(self._prefetch_next_track(room_id, db_session_factory, soundcloud_client))
                
                result = await stream_ffmpeg(bc, stream_url)

                if result == "expired":
                    print(f"🔄 [room] URL expired, refreshing...")
                    await asyncio.to_thread(_clear_stream_url, track_id)
                    last_track_id = -1
                    await asyncio.sleep(5)
                    continue

                if result == "skipped":
                    print(f"⏭️ [room] track skipped by admin")
                    await asyncio.sleep(0.3)
                    continue

                if not result:
                    break

                # Трек закончился — переходим к следующему
                advanced = await advance_track(room_id, db_session_factory)
                if not advanced:
                    bc.running = False
                    break

                await asyncio.sleep(0.3)

            except asyncio.CancelledError:
                break
            except Exception as e:
                print(f"❌ Room {room_id} broadcast error: {e}")
                import traceback; traceback.print_exc()
                await asyncio.sleep(3)

        bc.running = False
        await bc.broadcast_end()
        print(f"🔇 Room {room_id}: broadcast loop ended")

    # ------------------------------------------------------------------ #
    #  Helpers                                                             #
    # ------------------------------------------------------------------ #

    async def _prefetch_next_track(self, room_id: int, db_session_factory, soundcloud_client):
        """Предзагрузка stream URL для следующего трека пока играет текущий."""
        try:
            # Обновляем время активности
            self._last_activity[room_id] = _t.monotonic()
            
            await asyncio.sleep(5)  # Ждём 5с после старта текущего трека
            next_info = await peek_next_track(room_id, db_session_factory)
            if not next_info:
                return
            
            # Если URL уже есть и не истёк, ничего не делаем
            if next_info["stream_url"] and not self._is_url_expired(next_info["stream_url"]):
                print(f"⚡ [prefetch] Next track {next_info['id']} already has fresh URL")
                return
            
            # Запускаем prefetch
            if next_info["source_track_id"]:
                print(f"🔥 [prefetch] Fetching URL for next track: {next_info['title']}")
                await self.prefetch_track_url(
                    next_info["id"],
                    next_info["source_track_id"],
                    db_session_factory,
                    soundcloud_client
                )
        except Exception as e:
            print(f"⚠️ [prefetch] Error prefetching next track: {e}")

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

room_manager = RoomManager()
