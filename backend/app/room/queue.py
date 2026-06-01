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
    from app.database.models import RoomTrack, Track, TrackAsset, PlaybackSession
    try:
        from app.playback.timeline import timeline_manager
    except Exception:
        timeline_manager = None

    # Current track
    current = None
    if room.now_playing_track_id:
        current = db.query(RoomTrack).filter(RoomTrack.id == room.now_playing_track_id).first()

    if not current:
        return {
            "current_track_id": None,
            "current_track": None,
            "position": 0,
            "server_time": datetime.utcnow().isoformat(),
            "queue": [],
            "is_playing": False,
            "playback_session": None,
        }

    track = current

    # Position calculation
    elapsed = 0.0
    timeline_state = None
    if timeline_manager is not None:
        try:
            timeline_state = timeline_manager.get_current_state(room.id)
        except Exception:
            timeline_state = None

    if timeline_state and track:
        elapsed = min(timeline_state.get_position(), track.duration or 0)
    elif getattr(room, 'playback_started_at', None) and track:
        elapsed = (datetime.utcnow() - room.playback_started_at).total_seconds()
        elapsed = min(elapsed, track.duration or 0)

    # Build queue snapshot
    queue_rows = (
        db.query(RoomTrack)
        .filter(RoomTrack.room_id == room.id)
        .order_by(RoomTrack.order.nullsfirst(), RoomTrack.id)
        .all()
    )
    queue = []
    for r in queue_rows:
        asset_status = None
        try:
            t = db.query(Track).filter(Track.source == r.source, Track.source_track_id == r.source_track_id).first()
            if t:
                a = db.query(TrackAsset).filter(TrackAsset.track_id == t.id).order_by(TrackAsset.updated_at.desc()).first()
                if a:
                    asset_status = a.status
        except Exception:
            asset_status = None

        queue.append({
            "id": r.id,
            "title": r.title,
            "artist": r.artist,
            "duration": r.duration,
            "thumbnail": r.thumbnail or '',
            "genre": r.genre or '',
            "order": r.order,
            "added_by_id": r.added_by_id,
            "queue_state": getattr(r, 'queue_state', None),
            "asset_status": asset_status,
        })

    # Attach playback_session snapshot if exists
    session_obj = db.query(PlaybackSession).filter(PlaybackSession.room_id == room.id).first()
    session_dict = None
    if session_obj:
        session_dict = {
            "current_queue_item_id": session_obj.current_queue_item_id,
            "playback_state": session_obj.playback_state,
            "started_at": session_obj.started_at.isoformat() if session_obj.started_at else None,
            "expected_end_at": session_obj.expected_end_at.isoformat() if session_obj.expected_end_at else None,
            "playback_position": session_obj.playback_position,
            "generation": session_obj.generation,
            "updated_at": session_obj.updated_at.isoformat() if session_obj.updated_at else None,
        }

    return {
        "current_track_id": track.id if track else None,
        "current_track": {
            "id": track.id,
            "title": track.title,
            "artist": track.artist,
            "duration": track.duration,
            "thumbnail": track.thumbnail or "",
            "genre": track.genre or "",
        } if track else None,
        "position": elapsed,
        "server_time": datetime.utcnow().isoformat(),
        "queue": queue,
        "is_playing": bool(timeline_state.is_playing if timeline_state is not None else getattr(room, 'is_playing', False)),
        "playback_session": session_dict,
    }


async def advance_track(room_id: int, db_session_factory) -> bool:
    """
    Переходит к следующему треку в очереди.
    Возвращает True если трек найден, False если очередь пуста.
    """
    from app.database.models import Room, RoomTrack

    # Delegate advance to playback.controller to keep single authority
    try:
        from app.playback.controller import advance_playback
    except Exception as e:
        print(f"❌ advance_track import error: {e}")
        return False

    try:
        next_id = await asyncio.to_thread(advance_playback, room_id)
        if not next_id:
            return False

        # Build track data for broadcast
        db = db_session_factory()
        try:
            nt = db.query(RoomTrack).filter(RoomTrack.id == next_id).first()
            if not nt:
                return False
            track_data = {
                "id": nt.id,
                "title": nt.title,
                "artist": nt.artist,
                "duration": nt.duration,
                "thumbnail": nt.thumbnail or '',
                "genre": nt.genre or '',
            }
        finally:
            db.close()

        await broadcast_track_changed(room_id, track_data)
        return True
    except Exception as e:
        print(f"❌ advance_track error: {e}")
        import traceback; traceback.print_exc()
        return False


async def peek_next_track(room_id: int, db_session_factory) -> dict:
    """
    Получает информацию о следующем треке БЕЗ изменения состояния.
    Используется для prefetch stream URL.
    """
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
            # Do not expose filesystem paths
            return {
                "id": next_track.id,
                "source_track_id": next_track.source_track_id,
                "title": next_track.title,
            }
        return None
    except Exception as e:
        print(f"❌ peek_next_track error: {e}")
        return None
    finally:
        db.close()


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

        # Radio-mode rule: stream endpoint depends ONLY on now_playing_track_id.
        if room_id in manager.room_states:
            manager.room_states[room_id].update({
                "current_track": track_dict,
                "current_time": 0,
                "last_known_time": 0,
                "last_update_time": time.time(),
            })

        await manager.broadcast_event(room_id, 'track_changed', {"track": track_dict})
        print(f"📡 Room {room_id}: broadcast track_changed → '{track['title']}'")

    except Exception as e:
        print(f"⚠️ broadcast_track_changed error: {e}")
