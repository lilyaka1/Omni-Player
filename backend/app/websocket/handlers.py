"""
WebSocket handlers.
Правило: asyncio.to_thread() создаёт СВОЮ SessionLocal().
SQLAlchemy Session не thread-safe.
MVP RADIO-MODE: now_playing_track_id — единственный источник истины.
"""
import asyncio
import json
import time
from fastapi import WebSocket, status

from app.database.models import Room, RoomTrack, User, Message, SourceEnum, RoomRoleEnum, user_room_association, Track
from app.database.session import SessionLocal
from app.websocket.manager import manager
from app.domains.auth.service import decode_token
from app.room.queue import get_room_state
from app.services.metadata import split_artist_title


# -- Connection --

async def handle_connection(websocket: WebSocket, room_id: int, token):
    """Аутентификация и подключение. Возвращает (user_proxy, room_id, user_role) или None."""
    print(f"\n{'='*60}")
    print(f"WebSocket подключение: комната {room_id}")
    print(f"Токен: {'да' if token else 'НЕТ'}")
    print(f"{'='*60}")

    await websocket.accept()

    async def _close(code: int, reason: str):
        try:
            await websocket.send_json({"type": "error", "message": reason})
        except Exception:
            pass
        try:
            await websocket.close(code=code, reason=reason)
        except Exception:
            pass

    def _fetch_auth_data():
        _db = SessionLocal()
        try:
            room = _db.query(Room).filter(Room.id == room_id).first()
            if not room:
                return {"error": "room_not_found"}
            if not token:
                return {"error": "no_token"}
            user_identifier = decode_token(token)
            if not user_identifier:
                return {"error": "invalid_token"}
            user = None
            if str(user_identifier).isdigit():
                user = _db.query(User).filter(User.id == int(user_identifier)).first()
            if not user:
                user = _db.query(User).filter(
                    (User.email == user_identifier) | (User.username == user_identifier)
                ).first()
            if not user:
                return {"error": "user_not_found"}
            if user.is_blocked:
                return {"error": "user_blocked"}

            user_role = RoomRoleEnum.USER
            if room.creator_id == user.id:
                user_role = RoomRoleEnum.ADMIN
            else:
                stmt = user_room_association.select().where(
                    (user_room_association.c.user_id == user.id) &
                    (user_room_association.c.room_id == room_id)
                )
                existing = _db.execute(stmt).first()
                if existing:
                    user_role = existing.role

            room_state = get_room_state(_db, room) or {}
            return {
                "user_id": user.id,
                "user_email": user.email,
                "username": user.username,
                "user_role": user_role,
                "room_creator_id": room.creator_id,
                "room_state": room_state,
            }
        finally:
            _db.close()

    auth = await asyncio.to_thread(_fetch_auth_data)

    if "error" in auth:
        err = auth["error"]
        msgs = {
            "room_not_found": "Room not found",
            "no_token": "No token provided",
            "invalid_token": "Invalid token",
            "user_not_found": "User not found",
            "user_blocked": "User blocked",
        }
        print(f"WS auth failed: {err}")
        await _close(status.WS_1008_POLICY_VIOLATION, msgs.get(err, err))
        return None

    user_role = auth["user_role"]

    class _UserProxy:
        def __init__(self, d):
            self.id = d["user_id"]
            self.email = d["user_email"]
            self.username = d["username"]

    user = _UserProxy(auth)

    await manager.connect(websocket, room_id, user_id=user.id, user_role=user_role, skip_accept=True)
    print(f"🔌 WS connected: user={user.id} room={room_id} role={user_role}")

    # ── FIX #1 + #2: Bootstrap playback on join (this is the missing link) ──────
    try:
        from app.playback.bootstrap import join_room_and_start
        print(f"🚀 [WS] Calling join_room_and_start for room {room_id}...")
        result = await join_room_and_start(room_id, user.id)
        print(f"🚀 [WS] join_room_and_start result: ok={result.ok} now_playing={result.now_playing_track_id} actions={result.actions} errors={result.errors}")
    except Exception as e:
        print(f"❌ [WS] join_room_and_start failed: {e}")
        import traceback; traceback.print_exc()

    # ── FIX #3: Send FULL snapshot (queue + now_playing) on join ─────────────────
    def _build_snapshot():
        from datetime import datetime
        _db = SessionLocal()
        try:
            room = _db.query(Room).filter(Room.id == room_id).first()
            if not room:
                return {}

            queue = (
                _db.query(RoomTrack)
                .filter(RoomTrack.room_id == room_id)
                .order_by(RoomTrack.order.nullsfirst(), RoomTrack.id)
                .all()
            )
            now_playing = None
            if room.now_playing_track_id:
                now_playing = _db.query(RoomTrack).filter(
                    RoomTrack.id == room.now_playing_track_id
                ).first()

            # Calculate elapsed position for accurate client-side timing
            position = 0.0
            started_at_epoch = None
            if room.playback_started_at and now_playing:
                position = (datetime.utcnow() - room.playback_started_at).total_seconds()
                position = min(position, now_playing.duration or 0)
                try:
                    started_at_epoch = int(room.playback_started_at.timestamp())
                except Exception:
                    started_at_epoch = None

            is_playing = bool(getattr(room, 'is_playing', False))
            try:
                from app.playback.timeline import timeline_manager
                timeline_state = timeline_manager.get_current_state(room_id)
                if timeline_state:
                    position = round(timeline_state.get_position(), 3)
                    is_playing = bool(timeline_state.is_playing)
            except Exception:
                pass

            return {
                "current_track": {
                    "id": now_playing.id,
                    "title": now_playing.title,
                    "artist": now_playing.artist,
                    "duration": now_playing.duration or 0,
                    "thumbnail": now_playing.thumbnail or "",
                    "genre": now_playing.genre or "",
                    "started_at": started_at_epoch,
                } if now_playing else None,
                "queue": [
                    {
                        "id": t.id,
                        "title": t.title,
                        "artist": t.artist,
                        "duration": t.duration or 0,
                        "thumbnail": t.thumbnail or "",
                        "genre": t.genre or "",
                        "order": t.order,
                    }
                    for t in queue
                ],
                "is_playing": is_playing,
                "position": position,
                "playback_started_at": started_at_epoch,
            }
        finally:
            _db.close()

    snapshot = await asyncio.to_thread(_build_snapshot)

    # Send full snapshot so frontend sees queue + current track immediately
    payload = manager._wrap_event("room_state", {
        **snapshot,
        "user_role": str(user_role),
        "queue": snapshot.get("queue", []),
    })
    await websocket.send_json(payload)
    print(f"📡 [WS] snapshot sent: track={snapshot.get('current_track', {}).get('title') if snapshot.get('current_track') else 'NONE'}, queue_size={len(snapshot.get('queue', []))}")

    # Also send track_change in correct format so player.js handler works
    if snapshot.get("current_track"):
        await websocket.send_json(manager._wrap_event("track_change", {
            "current_track": snapshot["current_track"],
            "track": snapshot["current_track"],
        }))
        print(f"🎵 [WS] Sent track_change → '{snapshot['current_track']['title']}'")

    user_count = len(manager.active_connections.get(room_id, []))
    await manager.broadcast_event(room_id, 'user_count', {"count": user_count})
    return user, room_id, user_role


# -- Chat --

async def handle_chat(room_id: int, user, data: dict) -> None:
    def _save():
        _db = SessionLocal()
        try:
            msg = Message(room_id=room_id, user_id=user.id, content=data.get("content", ""))
            _db.add(msg)
            _db.commit()
            _db.refresh(msg)
            return {"id": msg.id, "timestamp": msg.created_at.isoformat()}
        finally:
            _db.close()

    result = await asyncio.to_thread(_save)
    await manager.broadcast_event(room_id, 'chat', {
        "id": result["id"],
        "user": user.username or user.email,
        "content": data.get("content", ""),
        "timestamp": result["timestamp"],
    })


# -- Track change --

async def handle_track_change(websocket: WebSocket, room_id: int, user, data: dict) -> None:
    try:
        track_data = data.get("track")
        track_id_req = data.get("track_id")
        _user_id = user.id

        def _db_work():
            _db = SessionLocal()
            try:
                track = None
                source_track_id = None

                if track_data:
                    source_track_id = track_data.get("source_track_id") or str(track_data.get("id", ""))
                    track = _db.query(RoomTrack).filter(
                        RoomTrack.room_id == room_id,
                        RoomTrack.source_track_id == source_track_id,
                    ).first()

                    if not track:
                        raw_stream_url = track_data.get("stream_url") or track_data.get("url", "")
                        resolved_url = raw_stream_url
                        if raw_stream_url == "pending://local-upload" or raw_stream_url.startswith("local-upload://"):
                            src_id = source_track_id
                            if src_id.isdigit():
                                orig = _db.query(Track).filter(Track.id == int(src_id)).first()
                                if orig and orig.local_file_path:
                                    resolved_url = f"/api/player/audio/{orig.id}"
                            if resolved_url in ("pending://local-upload", "") or resolved_url.startswith("local-upload://"):
                                sp_url = track_data.get("source_page_url") or ""
                                if sp_url.startswith("local-upload://"):
                                    orig = _db.query(Track).filter(
                                        Track.source == SourceEnum.LOCAL,
                                        Track.title == track_data.get("title", ""),
                                    ).first()
                                    if orig and orig.local_file_path:
                                        resolved_url = f"/api/player/audio/{orig.id}"

                        max_order = _db.query(RoomTrack).filter(RoomTrack.room_id == room_id).count()
                        title, artist = split_artist_title(
                            track_data.get("title", "Unknown"),
                            track_data.get("artist", "Unknown"),
                        )
                        track = RoomTrack(
                            room_id=room_id,
                            source=SourceEnum.SOUNDCLOUD,
                            source_track_id=source_track_id,
                            title=title,
                            artist=artist,
                            duration=track_data.get("duration", 0),
                            # NO-OP: avoid persisting resolved URL that could make
                            # the track appear playable. Playability is controlled
                            # by TrackAsset.status == 'ready'.
                            stream_url="",
                            thumbnail=track_data.get("thumbnail", ""),
                            genre=track_data.get("genre", ""),
                            order=max_order + 1,
                            added_by_id=_user_id,
                        )
                        _db.add(track)
                        _db.commit()
                        _db.refresh(track)
                        print(f"Added track: {track.title} (id={track.id})")

                elif track_id_req:
                    track = _db.query(RoomTrack).filter(RoomTrack.id == track_id_req).first()
                else:
                    return None

                if not track:
                    return None

                track_count = _db.query(RoomTrack).filter(RoomTrack.room_id == room_id).count()
                return {
                    "id": track.id,
                    "title": track.title,
                    "artist": track.artist,
                    "duration": track.duration,
                    "thumbnail": track.thumbnail or "",
                    "genre": track.genre or "",
                    "source_track_id": source_track_id,
                    "track_count": track_count,
                }
            finally:
                _db.close()

        result = await asyncio.to_thread(_db_work)

        if result is None:
            print(f"Track not found: {track_data or track_id_req}")
            return

        if result["source_track_id"]:
            try:
                from app.room.manager import room_manager
                from app.room.providers.soundcloud import soundcloud_client
                asyncio.create_task(
                    room_manager.prefetch_track_file(
                        result["id"],
                        result.get("source", "soundcloud"),
                        result["source_track_id"],
                        SessionLocal,
                        soundcloud_client,
                    )
                )
            except Exception as e:
                print(f"prefetch error: {e}")

        # Fetch real started_at from Room for accurate timeline
        def _get_started_at():
            _db = SessionLocal()
            try:
                room = _db.query(Room).filter(Room.id == room_id).first()
                if room and room.playback_started_at:
                    try:
                        return int(room.playback_started_at.timestamp())
                    except Exception:
                        return None
                return None
            finally:
                _db.close()

        started_at = await asyncio.to_thread(_get_started_at)

        track_dict = {k: result[k] for k in ("id", "title", "artist", "duration", "thumbnail", "genre")}
        track_dict["started_at"] = started_at

        # ── MVP: теперь только track_change (broadcast единого потока).
        await manager.broadcast_event(room_id, 'track_changed', {
            "track": track_dict,
            "playback_started_at": started_at,
        })

    except Exception as exc:
        print(f"track_change error: {exc}")
        import traceback; traceback.print_exc()
        await websocket.send_json({"type": "error", "message": str(exc)})


# -- Playback control --

async def handle_playback_control(room_id: int, data: dict) -> None:
    """MVP radio-mode playback control — только now_playing_track_id в БД.
    Никаких is_playing / is_live / broadcast state.
    """
    from datetime import datetime

    action = data.get("action")
    track_id = data.get("track_id")
    print(f"🎮 [PLAYBACK] MVP radio-mode: room={room_id} action={action}")

    def _db_play():
        _db = SessionLocal()
        try:
            room = _db.query(Room).filter(Room.id == room_id).first()
            if not room:
                return {"ok": False, "reason": "room_not_found"}
            if track_id:
                try:
                    requested_id = int(track_id)
                except Exception:
                    requested_id = None
                if requested_id and room.now_playing_track_id != requested_id:
                    from app.playback.controller import set_now_playing
                    if not set_now_playing(room_id, requested_id):
                        return {"ok": False, "reason": "track_not_found"}
                    return {"ok": True, "now_playing_track_id": requested_id}
            try:
                from app.playback.controller import start_playback
                started_id = start_playback(room_id)
                if not started_id:
                    return {"ok": False, "reason": "no_ready_track"}
                return {"ok": True, "now_playing_track_id": started_id}
            except Exception:
                return {"ok": False, "reason": "controller_error"}
        finally:
            _db.close()

    def _db_state():
        _db = SessionLocal()
        try:
            room = _db.query(Room).filter(Room.id == room_id).first()
            return get_room_state(_db, room) if room else {}
        finally:
            _db.close()

    if action == "next":
        try:
            from app.playback.controller import advance_playback
            result = await asyncio.to_thread(advance_playback, room_id)
            print(f"➡️ [PLAYBACK] Room {room_id}: advance_track result={result}")
        except Exception as exc:
            print(f"❌ [PLAYBACK] Room {room_id}: next error: {exc}")
        # Rebuild fresh state after advance
        room_state = await asyncio.to_thread(_db_state)
        ct = room_state.get("current_track")
        await manager.broadcast_event(room_id, 'room_state', {"current_track": ct, "is_playing": bool(ct)})
        if ct:
            await manager.broadcast_event(room_id, 'track_change', {"current_track": ct, "track": ct})
            print(f"🎵 [PLAYBACK] Broadcast track_change for '{ct.get('title')}'")
        return

    elif action == "play":
        res = await asyncio.to_thread(_db_play)
        if not res["ok"]:
            print(f"❌ [PLAYBACK] Room {room_id}: play failed - {res['reason']}")
            return
        print(f"✅ [PLAYBACK] MVP: now_playing_track_id={res['now_playing_track_id']}")

        room_state = await asyncio.to_thread(_db_state)
        ct = room_state.get("current_track")
        payload = {"current_track": ct, "is_playing": bool(room_state.get("is_playing", False)), "position": room_state.get("position", 0)}
        await manager.broadcast_event(room_id, 'room_state', payload)
        if ct:
            await manager.broadcast_event(room_id, 'track_change', {"current_track": ct, "track": ct, "is_playing": bool(room_state.get("is_playing", False)), "position": room_state.get("position", 0)})
        return

    elif action == "pause":
        def _db_pause():
            _db = SessionLocal()
            try:
                room = _db.query(Room).filter(Room.id == room_id).with_for_update().first()
                if not room:
                    return {"ok": False, "reason": "room_not_found"}
                room.is_playing = False
                _db.commit()
                return {"ok": True}
            finally:
                _db.close()

        try:
            from app.playback.timeline import timeline_manager
            timeline_manager.pause(room_id)
        except Exception:
            pass

        pause_res = await asyncio.to_thread(_db_pause)
        if not pause_res.get("ok"):
            print(f"❌ [PLAYBACK] Room {room_id}: pause failed - {pause_res.get('reason')}")
            return

        room_state = await asyncio.to_thread(_db_state)
        ct = room_state.get("current_track")
        payload = {"current_track": ct, "is_playing": False, "position": room_state.get("position", 0)}
        await manager.broadcast_event(room_id, 'room_state', payload)
        if ct:
            await manager.broadcast_event(room_id, 'track_change', {"current_track": ct, "track": ct, "is_playing": False, "position": room_state.get("position", 0)})
        return

    room_state = await asyncio.to_thread(_db_state)
    await manager.broadcast_event(room_id, 'room_state', {"current_track": room_state.get("current_track"), "is_playing": bool(room_state.get("is_playing", False)), "position": room_state.get("position", 0)})

    if room_state.get("current_track"):
        ct = room_state["current_track"]
        track_dict = {
            "id": ct.get("id"),
            "title": ct.get("title", ""),
            "artist": ct.get("artist", ""),
            "duration": ct.get("duration") or 0,
            "thumbnail": ct.get("thumbnail") or "",
            "genre": ct.get("genre") or "",
        }
        await manager.broadcast_event(room_id, 'track_changed', {"track": track_dict, "is_playing": bool(room_state.get("is_playing", False)), "position": room_state.get("position", 0)})


# -- Reorder queue --

async def handle_reorder_queue(room_id: int, data: dict) -> None:
    """Обработка reorder_queue: обновление порядка треков в комнате."""
    new_order = data.get("order", [])
    if not isinstance(new_order, list) or not new_order:
        return

    def _db_reorder():
        _db = SessionLocal()
        try:
            for idx, track_id in enumerate(new_order):
                track = _db.query(RoomTrack).filter(
                    RoomTrack.id == int(track_id),
                    RoomTrack.room_id == room_id,
                ).first()
                if track:
                    track.order = idx
            _db.commit()
            return True
        except Exception as e:
            print(f"reorder_queue error: {e}")
            _db.rollback()
            return False
        finally:
            _db.close()

    ok = await asyncio.to_thread(_db_reorder)
    if not ok:
        return

    def _db_queue():
        _db = SessionLocal()
        try:
            tracks = (
                _db.query(RoomTrack)
                .filter(RoomTrack.room_id == room_id)
                .order_by(RoomTrack.order, RoomTrack.id)
                .all()
            )
            return [
                {"id": t.id, "title": t.title, "artist": t.artist, "duration": t.duration or 0,
                 "thumbnail": t.thumbnail or "", "genre": t.genre or ""}
                for t in tracks
            ]
        finally:
            _db.close()

    queue = await asyncio.to_thread(_db_queue)
    await manager.broadcast_event(room_id, 'queue_reordered', {"queue": queue})