"""
Управление очередью треков комнаты.
Переход к следующему треку, WS-уведомление о смене.
"""
import asyncio
import json
import time
from datetime import datetime


def get_room_state(db, room) -> dict:
    """Текущее состояние воспроизведения комнаты."""
    if not room.now_playing_track_id:
        return {
            "current_track_id": None,
            "current_track": None,
            "position": 0,
            "server_time": datetime.utcnow().isoformat(),
            "is_playing": room.is_playing,
        }
    from app.database.models import RoomTrack
    track = db.query(RoomTrack).filter(RoomTrack.id == room.now_playing_track_id).first()
    if not track:
        return {
            "current_track_id": None,
            "current_track": None,
            "position": 0,
            "server_time": datetime.utcnow().isoformat(),
            "is_playing": room.is_playing,
        }
    elapsed = 0.0
    if room.playback_started_at:
        elapsed = (datetime.utcnow() - room.playback_started_at).total_seconds()
        elapsed = min(elapsed, track.duration or 0)
    return {
        "current_track_id": track.id,
        "current_track": {
            "id": track.id,
            "title": track.title,
            "artist": track.artist,
            "duration": track.duration,
            "thumbnail": track.thumbnail or "",
            "genre": track.genre or "",
        },
        "position": elapsed,
        "server_time": datetime.utcnow().isoformat(),
        "is_playing": room.is_playing,
    }


async def advance_track(room_id: int, db_session_factory) -> bool:
    """
    Переходит к следующему треку в очереди.
    Возвращает True если трек найден, False если очередь пуста.
    """
    from app.database.models import Room, RoomTrack

    def _do_advance_sync():
        """Все DB-операции в одном потоке — не блокируют event loop."""
        db = db_session_factory()
        try:
            room = db.query(Room).filter(Room.id == room_id).first()
            if not room:
                return None

            current_id = room.now_playing_track_id
            current = (
                db.query(RoomTrack).filter(RoomTrack.id == current_id).first()
                if current_id else None
            )

            next_track = None
            if current:
                if current.order is not None:
                    next_track = (
                        db.query(RoomTrack)
                        .filter(RoomTrack.room_id == room_id, RoomTrack.order > current.order)
                        .order_by(RoomTrack.order)
                        .first()
                    )
                else:
                    next_track = (
                        db.query(RoomTrack)
                        .filter(RoomTrack.room_id == room_id, RoomTrack.id > current.id)
                        .order_by(RoomTrack.id)
                        .first()
                    )

            # Loop mode
            if not next_track and room.queue_mode == 'loop':
                next_track = (
                    db.query(RoomTrack)
                    .filter(RoomTrack.room_id == room_id)
                    .order_by(RoomTrack.order.nullsfirst(), RoomTrack.id)
                    .first()
                )
                if next_track:
                    print(f"🔁 Room {room_id}: looped back to first track")

            if next_track:
                room.now_playing_track_id = next_track.id
                room.playback_started_at = datetime.utcnow()
                db.commit()
                print(f"🔄 Room {room_id}: advanced to track {next_track.id} ({next_track.title})")
                # Возвращаем сериализуемые данные (нельзя передавать ORM-объект из потока)
                return {
                    "id": next_track.id,
                    "title": next_track.title,
                    "artist": next_track.artist,
                    "duration": next_track.duration,
                    "thumbnail": next_track.thumbnail or '',
                    "genre": next_track.genre or '',
                }
            else:
                room.is_playing = False
                db.commit()
                print(f"⏹️ Room {room_id}: end of queue, stopping broadcast")
                return None

        except Exception as e:
            print(f"❌ advance_track DB error: {e}")
            import traceback; traceback.print_exc()
            return None
        finally:
            db.close()

    try:
        track_data = await asyncio.to_thread(_do_advance_sync)
        if track_data:
            await broadcast_track_changed(room_id, track_data)
            return True
        return False
    except Exception as e:
        print(f"❌ advance_track error: {e}")
        import traceback; traceback.print_exc()
        return False


async def peek_next_track(room_id: int, db_session_factory) -> dict:
    """
    Получает информацию о следующем треке БЕЗ изменения состояния.
    Используется для prefetch stream URL.
    """
    from app.database.models import Room, RoomTrack

    def _peek_sync():
        db = db_session_factory()
        try:
            room = db.query(Room).filter(Room.id == room_id).first()
            if not room:
                return None

            current_id = room.now_playing_track_id
            current = (
                db.query(RoomTrack).filter(RoomTrack.id == current_id).first()
                if current_id else None
            )

            next_track = None
            if current:
                if current.order is not None:
                    next_track = (
                        db.query(RoomTrack)
                        .filter(RoomTrack.room_id == room_id, RoomTrack.order > current.order)
                        .order_by(RoomTrack.order)
                        .first()
                    )
                else:
                    next_track = (
                        db.query(RoomTrack)
                        .filter(RoomTrack.room_id == room_id, RoomTrack.id > current.id)
                        .order_by(RoomTrack.id)
                        .first()
                    )

            # Loop mode
            if not next_track and room.queue_mode == 'loop':
                next_track = (
                    db.query(RoomTrack)
                    .filter(RoomTrack.room_id == room_id)
                    .order_by(RoomTrack.order.nullsfirst(), RoomTrack.id)
                    .first()
                )

            if next_track:
                return {
                    "id": next_track.id,
                    "source_track_id": next_track.source_track_id,
                    "stream_url": next_track.stream_url,
                    "title": next_track.title,
                }
            return None

        except Exception as e:
            print(f"❌ peek_next_track error: {e}")
            return None
        finally:
            db.close()

    try:
        return await asyncio.to_thread(_peek_sync)
    except Exception as e:
        print(f"❌ peek_next_track error: {e}")
        return None


async def broadcast_track_changed(room_id: int, track: dict) -> None:
    """Уведомить WS-клиентов о смене трека. track — словарь с данными трека."""
    try:
        from app.websocket.manager import manager

        track_dict = {
            "id": track["id"],
            "title": track["title"],
            "artist": track["artist"],
            "duration": track["duration"],
            "thumbnail": track.get("thumbnail") or '',
            "genre": track.get("genre") or '',
            "started_at": int(time.time()),  # UNIX timestamp — клиент считает elapsed
        }

        if room_id in manager.room_states:
            manager.room_states[room_id].update({
                "current_track": track_dict,
                "current_time": 0,
                "last_known_time": 0,
                "is_playing": True,
                "last_update_time": time.time(),
            })

        await manager.broadcast(room_id, json.dumps({
            "type": "track_changed",
            "track": track_dict,
        }))
        print(f"📡 Room {room_id}: broadcast track_changed → '{track['title']}'")

    except Exception as e:
        print(f"⚠️ broadcast_track_changed error: {e}")
