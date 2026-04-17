"""
Rooms domain router — CRUD комнат, треки, участники.
"""
import asyncio
from fastapi import APIRouter, Depends, HTTPException, status
from sqlalchemy.orm import Session
from typing import List

from app.database.session import get_db
from app.database.models import User, Room, RoomTrack
from app.domains.rooms.schemas import (
    RoomCreate, RoomUpdate, RoomResponse, RoomDetailResponse,
    RoomTrackCreate, RoomTrackResponse,
)
from app.core.dependencies import get_current_user
from app.room.queue import get_room_state
from app.domains.rooms import service

router = APIRouter(prefix="/rooms", tags=["rooms"])


def _online_count(room_id: int) -> int:
    """Число WebSocket-подключений к комнате прямо сейчас."""
    try:
        from app.websocket.manager import manager
        return len(manager.active_connections.get(room_id, []))
    except Exception:
        return 0


def _room_detail(room: "Room") -> dict:
    """Добавляет runtime-поля к ответу комнаты."""
    data = RoomDetailResponse.model_validate(room)
    data.online_count = _online_count(room.id)
    data.is_playing = room.is_playing
    data.queue_mode = room.queue_mode or "loop"
    return data


def _require_room_owner(room: "Room", user: "User") -> None:
    """Проверяет права: user должен быть создателем комнаты или admin. Иначе выбрасывает 403."""
    if user.id != room.creator_id and user.role.value != "admin":
        raise HTTPException(status_code=status.HTTP_403_FORBIDDEN, detail="Not allowed")


# ── CRUD комнаты ──────────────────────────────────────────────────────

@router.post("/", response_model=RoomResponse)
async def create_room(
    room: RoomCreate,
    current_user: User = Depends(get_current_user),
    db: Session = Depends(get_db),
):
    if not current_user.can_create_rooms:
        raise HTTPException(status_code=status.HTTP_403_FORBIDDEN,
                            detail="User is not allowed to create rooms")
    return service.create_room(db, room.name, room.description, current_user)


@router.get("/", response_model=List[RoomResponse])
async def get_rooms(db: Session = Depends(get_db)):
    return db.query(Room).filter(Room.is_active == True).all()


@router.get("/my/rooms", response_model=List[RoomResponse])
async def get_my_rooms(
    current_user: User = Depends(get_current_user),
    db: Session = Depends(get_db),
):
    return db.query(Room).filter(
        Room.creator_id == current_user.id, Room.is_active == True
    ).all()


@router.get("/{room_id}", response_model=RoomDetailResponse)
async def get_room(room_id: int, db: Session = Depends(get_db)):
    room = service.get_room_or_404(db, room_id)
    return _room_detail(room)


@router.patch("/{room_id}", response_model=RoomDetailResponse)
async def update_room(
    room_id: int,
    body: "RoomUpdate",
    current_user: User = Depends(get_current_user),
    db: Session = Depends(get_db),
):
    room = service.get_room_or_404(db, room_id)
    _require_room_owner(room, current_user)
    room = service.update_room(db, room, body.name, body.description)
    return _room_detail(room)


@router.delete("/{room_id}")
async def delete_room(
    room_id: int,
    current_user: User = Depends(get_current_user),
    db: Session = Depends(get_db),
):
    room = service.get_room_or_404(db, room_id)
    _require_room_owner(room, current_user)
    try:
        from app.room.manager import room_manager
        if room_manager.is_live(room_id):
            await room_manager.stop_room(room_id)
    except Exception:
        pass
    service.delete_room(db, room)
    return {"message": f"Room '{room.name}' deleted"}


@router.get("/{room_id}/playback-state")
async def get_playback_state(room_id: int, db: Session = Depends(get_db)):
    room = service.get_room_or_404(db, room_id)
    return get_room_state(db, room)


# ── Треки ─────────────────────────────────────────────────────────────

@router.post("/{room_id}/tracks", response_model=RoomTrackResponse)
async def add_track_to_room(
    room_id: int,
    track: RoomTrackCreate,
    current_user: User = Depends(get_current_user),
    db: Session = Depends(get_db),
):
    service.get_room_or_404(db, room_id)
    return service.add_track(
        db, room_id, current_user.id,
        source=track.source,
        source_track_id=track.source_track_id,
        title=track.title,
        artist=track.artist,
        duration=track.duration,
        stream_url=track.stream_url,
        thumbnail=track.thumbnail,
        genre=track.genre,
    )


@router.get("/{room_id}/tracks", response_model=List[RoomTrackResponse])
async def get_room_tracks(room_id: int, db: Session = Depends(get_db)):
    service.get_room_or_404(db, room_id)
    tracks = (
        db.query(RoomTrack)
        .filter(RoomTrack.room_id == room_id)
        .order_by(RoomTrack.order)
        .all()
    )
    # Фоновый refresh для треков с пустым stream_url
    stale = [t for t in tracks if not t.stream_url and t.source_track_id]
    if stale:
        try:
            from app.room.manager import room_manager
            from app.database.session import SessionLocal
            from app.room.providers.soundcloud import soundcloud_client
            for t in stale:
                asyncio.create_task(
                    room_manager.prefetch_track_url(t.id, t.source_track_id, SessionLocal, soundcloud_client)
                )
        except Exception:
            pass
    return tracks


@router.delete("/{room_id}/tracks/{track_id}")
async def remove_track_from_room(
    room_id: int,
    track_id: int,
    current_user: User = Depends(get_current_user),
    db: Session = Depends(get_db),
):
    track = db.query(RoomTrack).filter(
        RoomTrack.id == track_id, RoomTrack.room_id == room_id
    ).first()
    if not track:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Track not found")

    room = service.get_room_or_404(db, room_id)
    _require_room_owner(room, current_user)

    was_playing = (room.now_playing_track_id == track_id)

    # Сначала снимаем FK-ссылку чтобы не получить constraint violation
    if was_playing:
        room.now_playing_track_id = None
        room.is_playing = False
        db.flush()

    service.remove_track(db, track)

    # Broadcast queue_updated
    try:
        from app.websocket.manager import manager
        import json
        await manager.broadcast(room_id, json.dumps({"type": "queue_updated"}))
        if was_playing:
            ws_state = manager.get_room_state(room_id)
            if ws_state:
                ws_state["current_track"] = None
                ws_state["is_playing"] = False
            await manager.broadcast(room_id, json.dumps({"type": "track_changed", "track": None}))
    except Exception:
        pass

    return {"message": "Track deleted"}


@router.post("/{room_id}/tracks/{track_id}/refresh-url", response_model=RoomTrackResponse)
async def refresh_track_url(
    room_id: int,
    track_id: int,
    current_user: User = Depends(get_current_user),
    db: Session = Depends(get_db),
):
    """Принудительно обновить CDN stream_url трека (SoundCloud URLs протухают)."""
    track = db.query(RoomTrack).filter(
        RoomTrack.id == track_id, RoomTrack.room_id == room_id
    ).first()
    if not track:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Track not found")
    if not track.source_track_id:
        raise HTTPException(status_code=status.HTTP_400_BAD_REQUEST, detail="No source_track_id")
    try:
        from app.room.manager import room_manager
        from app.database.session import SessionLocal
        from app.room.providers.soundcloud import soundcloud_client
        await room_manager.prefetch_track_url(track.id, track.source_track_id, SessionLocal, soundcloud_client)
        db.refresh(track)
    except Exception as e:
        raise HTTPException(status_code=500, detail=str(e))
    return track


@router.delete("/{room_id}/tracks")
async def clear_room_queue(
    room_id: int,
    current_user: User = Depends(get_current_user),
    db: Session = Depends(get_db),
):
    room = service.get_room_or_404(db, room_id)
    _require_room_owner(room, current_user)

    # Останавливаем стрим если запущен
    try:
        from app.room.manager import room_manager
        if room_manager.is_live(room_id):
            await room_manager.stop_room(room_id)
    except Exception:
        pass

    deleted = service.clear_queue(db, room)

    # WS broadcast: очередь пуста, трек сброшен
    try:
        from app.websocket.manager import manager
        import json

        ws_state = manager.get_room_state(room_id)
        if ws_state:
            ws_state["current_track"] = None
            ws_state["is_playing"] = False
            ws_state["current_time"] = 0

        await manager.broadcast(room_id, json.dumps({"type": "queue_updated"}))
        await manager.broadcast(room_id, json.dumps({"type": "track_changed", "track": None}))
    except Exception:
        pass

    return {"message": f"Deleted {deleted} tracks"}


@router.put("/{room_id}/tracks/reorder")
async def reorder_tracks(
    room_id: int,
    body: dict,
    current_user: User = Depends(get_current_user),
    db: Session = Depends(get_db),
):
    room = service.get_room_or_404(db, room_id)
    _require_room_owner(room, current_user)

    service.reorder_tracks(db, room_id, body.get("order", []))
    return {"message": "Reordered"}


# ── Участники ─────────────────────────────────────────────────────────

@router.post("/{room_id}/join")
async def join_room(
    room_id: int,
    current_user: User = Depends(get_current_user),
    db: Session = Depends(get_db),
):
    room = service.get_room_or_404(db, room_id)
    if current_user not in room.users:
        room.users.append(current_user)
        db.commit()
    return {"message": f"Joined room '{room.name}'", "room_id": room_id}


@router.post("/{room_id}/leave")
async def leave_room(
    room_id: int,
    current_user: User = Depends(get_current_user),
    db: Session = Depends(get_db),
):
    room = service.get_room_or_404(db, room_id)
    if current_user in room.users:
        room.users.remove(current_user)
        db.commit()
    return {"message": f"Left room '{room.name}'", "room_id": room_id}


@router.get("/{room_id}/users")
async def get_room_users(room_id: int, db: Session = Depends(get_db)):
    room = service.get_room_or_404(db, room_id)
    return {
        "room_id": room_id,
        "room_name": room.name,
        "user_count": len(room.users),
        "users": [
            {"id": u.id, "email": u.email, "username": u.username}
            for u in room.users
        ],
    }
