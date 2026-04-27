"""
WebSocket handlers.
Правило: asyncio.to_thread() создаёт СВОЮ SessionLocal().
SQLAlchemy Session не thread-safe.
"""
import asyncio
import json
from fastapi import WebSocket, status

from app.database.models import Room, RoomTrack, User, Message, SourceEnum, RoomRoleEnum, user_room_association
from app.database.session import SessionLocal
from app.websocket.manager import manager
from app.domains.auth.service import decode_token
from app.room.queue import get_room_state


# -- Connection --

async def handle_connection(websocket: WebSocket, room_id: int, token):
    """Аутентификация и подключение. Возвращает (user_proxy, room_id, user_role) или None."""
    print(f"\n{'='*60}")
    print(f"WebSocket подключение: комната {room_id}")
    print(f"Токен: {'да' if token else 'НЕТ'}")
    print(f"{'='*60}")

    await websocket.accept()  # ПЕРВЫМ — до любых DB-запросов

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
            email = decode_token(token)
            if not email:
                return {"error": "invalid_token"}
            user = _db.query(User).filter(User.email == email).first()
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
                "playback_started_at": room.playback_started_at.isoformat() if room.playback_started_at else None,
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
    room_state = auth["room_state"]

    class _UserProxy:
        def __init__(self, d):
            self.id = d["user_id"]
            self.email = d["user_email"]
            self.username = d["username"]

    user = _UserProxy(auth)

    await manager.connect(websocket, room_id, user_id=user.id, user_role=user_role, skip_accept=True)

    try:
        from app.room.manager import room_manager
        is_playing_live = room_manager.is_live(room_id)
    except Exception:
        is_playing_live = room_state.get("is_playing", False)

    if room_state.get("current_track"):
        manager.room_states[room_id]["current_track"] = room_state["current_track"]
        manager.room_states[room_id]["position"] = room_state.get("position", 0)
        manager.room_states[room_id]["is_playing"] = is_playing_live
        manager.room_states[room_id]["playback_started_at"] = auth["playback_started_at"]
        manager.room_states[room_id]["server_time"] = room_state.get("server_time")
    else:
        manager.room_states[room_id]["is_playing"] = is_playing_live

    state_with_role = {**manager.room_states[room_id], "user_role": str(user_role)}
    await websocket.send_json({"type": "room_state", "data": state_with_role})

    user_count = len(manager.active_connections.get(room_id, []))
    await manager.broadcast(room_id, json.dumps({"type": "user_count", "count": user_count}))
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
            return msg.created_at.isoformat()
        finally:
            _db.close()

    ts = await asyncio.to_thread(_save)
    await manager.broadcast(room_id, json.dumps({
        "type": "chat",
        "user": user.username or user.email,
        "content": data.get("content", ""),
        "timestamp": ts,
    }))


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
                        stream_url = track_data.get("stream_url") or track_data.get("url", "")
                        max_order = _db.query(RoomTrack).filter(RoomTrack.room_id == room_id).count()
                        track = RoomTrack(
                            room_id=room_id,
                            source=SourceEnum.SOUNDCLOUD,
                            source_track_id=source_track_id,
                            title=track_data.get("title", "Unknown"),
                            artist=track_data.get("artist", "Unknown"),
                            duration=track_data.get("duration", 0),
                            stream_url=stream_url,
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
                    room_manager.prefetch_track_url(result["id"], result["source_track_id"], SessionLocal, soundcloud_client)
                )
            except Exception as e:
                print(f"prefetch error: {e}")

        track_dict = {k: result[k] for k in ("id", "title", "artist", "duration", "thumbnail", "genre")}

        if result["track_count"] == 1:
            new_state = manager.set_room_state(room_id, track=track_dict, is_playing=True)
            await manager.broadcast(room_id, json.dumps({"type": "track_change", "data": new_state}))
        else:
            await manager.broadcast(room_id, json.dumps({
                "type": "queue_updated",
                "data": {"track_added": track_dict, "queue_position": result["track_count"]},
            }))

    except Exception as exc:
        print(f"track_change error: {exc}")
        import traceback; traceback.print_exc()
        await websocket.send_json({"type": "error", "message": str(exc)})


# -- Playback control --

async def handle_playback_control(room_id: int, data: dict) -> None:
    """Каждый DB-вызов — собственная сессия в своём потоке."""
    from datetime import datetime

    action = data.get("action")
    track_id = data.get("track_id")
    print(f"🎮 [PLAYBACK] Room {room_id}: action={action}, track_id={track_id}")

    def _db_play():
        _db = SessionLocal()
        try:
            room = _db.query(Room).filter(Room.id == room_id).first()
            if not room:
                return {"ok": False, "reason": "room_not_found"}
            if track_id:
                room.now_playing_track_id = track_id
            elif not room.now_playing_track_id:
                first = (
                    _db.query(RoomTrack)
                    .filter(RoomTrack.room_id == room_id)
                    .order_by(RoomTrack.order.nullsfirst(), RoomTrack.id)
                    .first()
                )
                if first:
                    room.now_playing_track_id = first.id
                else:
                    return {"ok": False, "reason": "no_tracks"}
            room.playback_started_at = datetime.utcnow()
            room.is_playing = True
            _db.commit()
            return {"ok": True, "started_at": room.playback_started_at.isoformat()}
        finally:
            _db.close()

    def _db_pause():
        _db = SessionLocal()
        try:
            room = _db.query(Room).filter(Room.id == room_id).first()
            if room:
                room.is_playing = False
                _db.commit()
        finally:
            _db.close()

    def _db_state():
        _db = SessionLocal()
        try:
            room = _db.query(Room).filter(Room.id == room_id).first()
            return get_room_state(_db, room) if room else {}
        finally:
            _db.close()

    is_playing = False
    started_at = None

    if action == "play":
        res = await asyncio.to_thread(_db_play)
        if not res["ok"]:
            print(f"❌ [PLAYBACK] Room {room_id}: play failed - {res['reason']}")
            return
        started_at = res["started_at"]
        is_playing = True
        print(f"✅ [PLAYBACK] Room {room_id}: DB updated, started_at={started_at}")
        
        try:
            from app.room.manager import room_manager
            from app.room.providers.soundcloud import soundcloud_client
            
            if not room_manager.is_live(room_id):
                print(f"🚀 [PLAYBACK] Room {room_id}: Starting new broadcast")
                asyncio.create_task(room_manager.start_room(room_id, SessionLocal, soundcloud_client))
            else:
                print(f"⏭️ [PLAYBACK] Room {room_id}: Broadcast already running, triggering skip")
                bc = room_manager.broadcasts.get(room_id)
                if bc:
                    bc.skip_event.set()
                    bc.current_track_id = None
        except Exception as exc:
            print(f"❌ [PLAYBACK] Room {room_id}: broadcast error: {exc}")
            import traceback
            traceback.print_exc()

    elif action == "pause":
        print(f"⏸️ [PLAYBACK] Room {room_id}: Pausing broadcast")
        await asyncio.to_thread(_db_pause)
        try:
            from app.room.manager import room_manager
            if room_manager.is_live(room_id):
                print(f"🛑 [PLAYBACK] Room {room_id}: Stopping broadcast")
                await room_manager.stop_room(room_id)
            else:
                print(f"ℹ️ [PLAYBACK] Room {room_id}: Broadcast already stopped")
        except Exception as exc:
            print(f"❌ [PLAYBACK] Room {room_id}: stop error: {exc}")
            import traceback
            traceback.print_exc()

    room_state = await asyncio.to_thread(_db_state)
    update_data = {
        "is_playing": is_playing,
        "position": room_state.get("position"),
        "playback_started_at": started_at or room_state.get("playback_started_at"),
        "server_time": room_state.get("server_time"),
    }
    # Обновляем current_track чтобы слушатели получили метаданные нового трека
    if room_state.get("current_track"):
        update_data["current_track"] = room_state["current_track"]
    manager.room_states[room_id].update(update_data)
    await manager.broadcast(room_id, json.dumps({"type": "room_state", "data": manager.room_states[room_id]}))
