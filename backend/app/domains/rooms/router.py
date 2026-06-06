from typing import List
from pathlib import Path
from uuid import uuid4
import asyncio
import json as json_lib

from fastapi import APIRouter, Depends, HTTPException, status, Query, UploadFile, File, Body
from sqlalchemy.orm import Session
from app.core.dependencies import get_db, get_current_user
from app.database.models import User, RoomTrack, Room, Track, SourceEnum
from app.domains.rooms.service import RoomService
from app.domains.rooms.schemas import RoomCreate, RoomResponse, RoomUpdate, RoomDetailResponse, RoomUserResponse
from app.domains.auth.service import AuthService
from app.room.queue import get_room_state
from app.services.metadata import split_artist_title
from app.domains.auth.service import decode_token
from fastapi import Request

router = APIRouter(prefix="/rooms", tags=["rooms"])


async def _broadcast_queue_update(room_id: int, db: Session):
    """Broadcast updated queue state to all WebSocket clients in the room."""
    try:
        room = db.query(Room).filter(Room.id == room_id).first()
        if not room:
            return
        queue_data = get_room_state(db, room)
        queue = queue_data.get("queue", [])
        
        from app.websocket.manager import manager as ws_manager
        if ws_manager and room_id in ws_manager.active_connections:
            payload = {
                "type": "queue_update",
                "data": {
                    "queue": queue,
                    "queue_version": getattr(room, 'queue_version', 0),
                    "current_track_id": queue_data.get("current_track_id"),
                    "current_track": queue_data.get("current_track"),
                    "playback_session": queue_data.get("playback_session"),
                },
                "event_id": str(uuid4()),
            }
            msg = json_lib.dumps(payload)
            await ws_manager.broadcast(room_id, msg)
            print(f"📡 [router] broadcast_queue_update for room {room_id}, queue_size={len(queue)}")
    except Exception as e:
        print(f"⚠️ [router] _broadcast_queue_update failed: {e}")


def _get_download_status(stream_url: str) -> str:
    value = str(stream_url or '').strip()
    if value and Path(value).is_file():
        return 'ready'
    return 'downloading'


def _serialize_room(room):
    # Get listener count from WebSocket manager
    from app.websocket.manager import manager
    listener_count = 0
    if room.id in manager.active_connections:
        listener_count = len(manager.active_connections[room.id])
    
    return {
        "id": room.id,
        "name": room.name,
        "description": room.description,
        "room_type": getattr(room, "room_type", None) or "public",
        "owner_id": getattr(room, "creator_id", None),
        "is_active": bool(getattr(room, "is_active", True)),
        "max_users": getattr(room, "max_users", None) or 50,
        "current_users": listener_count,
        "listener_count": listener_count,
        "cover_url": getattr(room, "cover_url", None),
        "genre": getattr(room, "genre", None),
        "created_at": room.created_at,
        "updated_at": room.updated_at,
    }

@router.get("/", response_model=List[RoomResponse])
def list_rooms(
    skip: int = Query(0, ge=0),
    limit: int = Query(20, ge=1, le=100),
    public_only: bool = True,
    db: Session = Depends(get_db)
):
    """Get list of all rooms."""
    room_service = RoomService(db)
    rooms = room_service.get_rooms(skip=skip, limit=limit, public_only=public_only)
    return [_serialize_room(room) for room in rooms]


@router.get("/my/rooms", response_model=List[RoomResponse])
def list_my_rooms(
    current_user: User = Depends(get_current_user),
    db: Session = Depends(get_db)
):
    """Get rooms joined by current user."""
    if not current_user:
        return []

    room_service = RoomService(db)
    rooms = room_service.get_user_rooms(current_user.id)
    return [_serialize_room(room) for room in rooms]


@router.post("/{room_id}/join")
def join_room(
    room_id: int,
    password: str = Body(None),
    current_user: User = Depends(get_current_user),
    db: Session = Depends(get_db),
):
    if not current_user:
        raise HTTPException(status_code=status.HTTP_401_UNAUTHORIZED, detail="Not authenticated")

    room_service = RoomService(db)
    room = room_service.get_room(room_id)
    
    if not room:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Room not found")
    
    # Проверка пароля для приватных комнат
    if room.room_type == "private" and room.password_hash:
        if not password:
            raise HTTPException(
                status_code=status.HTTP_403_FORBIDDEN, 
                detail="Password required for private room"
            )
        
        auth_service = AuthService(db)
        if not auth_service.verify_password(password, room.password_hash):
            raise HTTPException(
                status_code=status.HTTP_403_FORBIDDEN, 
                detail="Incorrect password"
            )
    
    if not room_service.join_room(room_id, current_user):
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Room not found")
    return {"success": True}


@router.post("/{room_id}/leave")
def leave_room(
    room_id: int,
    current_user: User = Depends(get_current_user),
    db: Session = Depends(get_db),
):
    if not current_user:
        raise HTTPException(status_code=status.HTTP_401_UNAUTHORIZED, detail="Not authenticated")

    room_service = RoomService(db)
    if not room_service.leave_room(room_id, current_user):
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Room not found")
    return {"success": True}


@router.get("/{room_id}/users")
def list_room_users(
    room_id: int,
    db: Session = Depends(get_db),
):
    room_service = RoomService(db)
    room = room_service.get_room(room_id)
    if not room:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Room not found")

    users = room_service.get_room_users(room_id)
    return {
        "users": [
            {
                "id": user.id,
                "username": user.username,
                "display_name": getattr(user, "display_name", None),
                "avatar_url": getattr(user, "avatar_url", None),
                "role": getattr(user, "role", "user"),
            }
            for user in users
        ]
    }


@router.get("/{room_id}/playback-state")
def get_playback_state(
    room_id: int,
    db: Session = Depends(get_db),
):
    """Get current playback state for a room."""
    room_service = RoomService(db)
    room = room_service.get_room(room_id)
    if not room:
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND,
            detail="Room not found"
        )

    return get_room_state(db, room)


@router.get("/{room_id}/tracks")
def list_room_tracks(
    room_id: int,
    db: Session = Depends(get_db),
):
    room_service = RoomService(db)
    room = room_service.get_room(room_id)
    if not room:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Room not found")

    tracks = (
        db.query(RoomTrack)
        .filter(RoomTrack.room_id == room_id)
        .order_by(RoomTrack.order)
        .all()
    )
    return [
        {
            "id": track.id,
            "source": track.source,
            "source_track_id": track.source_track_id,
            "title": track.title,
            "artist": track.artist,
            "duration": track.duration,
            "queue_state": getattr(track, 'queue_state', None),
            "asset_status": None,
            "thumbnail": track.thumbnail or "",
            "genre": track.genre or "",
            "order": track.order,
            "added_by_id": track.added_by_id,
        }
        for track in tracks
    ]


@router.post("/{room_id}/tracks", status_code=status.HTTP_201_CREATED)
async def add_room_track(
    room_id: int,
    request: Request,
    current_user: User = Depends(get_current_user),
    db: Session = Depends(get_db),
):
    if not current_user:
        raise HTTPException(status_code=status.HTTP_401_UNAUTHORIZED, detail="Not authenticated")

    room_service = RoomService(db)
    room = room_service.get_room(room_id)
    if not room:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Room not found")

    payload = await request.json()
    if not isinstance(payload, dict):
        raise HTTPException(status_code=status.HTTP_400_BAD_REQUEST, detail="Invalid payload")

    max_order = (
        db.query(RoomTrack.order)
        .filter(RoomTrack.room_id == room_id)
        .order_by(RoomTrack.order.desc())
        .first()
    )
    next_order = (max_order[0] if max_order and max_order[0] is not None else 0) + 1

    title, artist = split_artist_title(
        payload.get("title") or "Без названия",
        payload.get("artist") or "Unknown",
    )

    # ── Resolve stream_url: локальный файл → играбельный /api/player/audio/{id} ──
    raw_stream_url = payload.get("stream_url") or payload.get("url") or ""
    resolved_stream_url = raw_stream_url

    if raw_stream_url == "pending://local-upload" or raw_stream_url.startswith("local-upload://"):
        # Найти оригинальный Track по source_track_id (id из библиотеки)
        src_id = payload.get("source_track_id") or ""
        if src_id.isdigit():
            orig_track = db.query(Track).filter(Track.id == int(src_id)).first()
            if orig_track and orig_track.local_file_path:
                resolved_stream_url = f"/api/player/audio/{orig_track.id}"
        # Fallback: если source_track_id не число, ищем по source_page_url
        if resolved_stream_url in ("pending://local-upload", "") or resolved_stream_url.startswith("local-upload://"):
            sp_url = payload.get("source_page_url") or ""
            if sp_url.startswith("local-upload://"):
                orig_name = sp_url.replace("local-upload://", "")
                orig_track = db.query(Track).filter(
                    Track.source == SourceEnum.LOCAL,
                    Track.title == title,
                ).first()
                if orig_track and orig_track.local_file_path:
                    resolved_stream_url = f"/api/player/audio/{orig_track.id}"

    track = RoomTrack(
        room_id=room_id,
        source=payload.get("source") or "youtube",
        source_track_id=payload.get("source_track_id") or str(payload.get("id") or ""),
        title=title,
        artist=artist,
        duration=payload.get("duration") or 0,
        # NO-OP: do NOT persist resolved stream URL here. Playability must be
        # determined solely by TrackAsset.status == 'ready'. Store empty string.
        stream_url="",
        thumbnail=payload.get("thumbnail") or payload.get("thumb_url") or "",
        genre=payload.get("genre") or "",
        order=next_order,
        added_by_id=current_user.id,
    )
    db.add(track)
    db.commit()
    db.refresh(track)

    # Set initial queue_state: if there is a matching Track with a ready asset,
    # mark 'ready'; if it's a pending local upload, mark 'waiting_download'.
    try:
        from app.database.models import Track, TrackAsset
        orig = db.query(Track).filter(
            Track.source == track.source,
            Track.source_track_id == track.source_track_id,
        ).first()
        if orig:
            asset = (
                db.query(TrackAsset)
                .filter(TrackAsset.track_id == orig.id)
                .order_by(TrackAsset.updated_at.desc())
                .first()
            )
            if asset and asset.status == 'ready':
                try:
                    from app.playback.controller import update_queue_state
                    update_queue_state(track.id, 'ready')
                except Exception:
                    pass
            else:
                try:
                    from app.playback.controller import update_queue_state
                    update_queue_state(track.id, 'waiting_download')
                except Exception:
                    pass
        else:
            # Legacy/unknown tracks: assume ready to avoid blocking
            try:
                from app.playback.controller import update_queue_state
                update_queue_state(track.id, 'ready')
            except Exception:
                pass
        db.commit()
    except Exception:
        # best-effort, do not fail the request
        pass

    # Only set as now_playing if there is a ready TrackAsset for this track.
    # asset may have been retrieved above when resolving orig; if not, try to find Track
    try:
        if 'asset' not in locals() or asset is None:
            from app.database.models import Track, TrackAsset
            t = db.query(Track).filter(
                Track.source == track.source,
                Track.source_track_id == track.source_track_id,
            ).first()
            if t:
                asset = (
                    db.query(TrackAsset)
                    .filter(TrackAsset.track_id == t.id)
                    .order_by(TrackAsset.updated_at.desc())
                    .first()
                )
            else:
                asset = None
    except Exception:
        asset = None

    if not room.now_playing_track_id and asset and asset.status == 'ready':
        try:
            from app.playback.controller import start_playback
            started_id = start_playback(room_id)
            if started_id:
                try:
                    from app.playback.loop import playback_loop
                    playback_loop.register_room(room_id)
                    print(f"🎵 [router] First track added — playback loop registered for room {room_id}")
                except Exception as e:
                    print(f"⚠️ [router] playback_loop.register_room failed: {e}")
        except Exception:
            # best-effort: do not block the API
            pass

    # Broadcast queue update to all WS clients
    try:
        asyncio.create_task(_broadcast_queue_update(room_id, db))
    except Exception as e:
        print(f"⚠️ [router] broadcast_queue_update after add failed: {e}")

    return {
        "id": track.id,
        "title": track.title,
        "artist": track.artist,
        "duration": track.duration,
        "thumbnail": track.thumbnail or "",
        "genre": track.genre or "",
        "order": track.order,
        "added_by_id": track.added_by_id,
    }


@router.delete("/{room_id}/tracks/{track_id}", status_code=status.HTTP_204_NO_CONTENT)
def delete_room_track(
    room_id: int,
    track_id: int,
    current_user: User = Depends(get_current_user),
    db: Session = Depends(get_db),
):
    if not current_user:
        raise HTTPException(status_code=status.HTTP_401_UNAUTHORIZED, detail="Not authenticated")

    room_service = RoomService(db)
    room = room_service.get_room(room_id)
    if not room:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Room not found")

    track = (
        db.query(RoomTrack)
        .filter(RoomTrack.room_id == room_id, RoomTrack.id == track_id)
        .first()
    )
    if not track:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Track not found")

    if track.added_by_id != current_user.id and room.creator_id != current_user.id and current_user.role != "admin":
        raise HTTPException(status_code=status.HTTP_403_FORBIDDEN, detail="Not authorized")

    db.delete(track)
    db.commit()

    # Broadcast queue update to all WS clients
    try:
        asyncio.create_task(_broadcast_queue_update(room_id, db))
    except Exception as e:
        print(f"⚠️ [router] broadcast_queue_update after delete failed: {e}")


@router.delete("/{room_id}/tracks", status_code=status.HTTP_204_NO_CONTENT)
def clear_room_tracks(
    room_id: int,
    current_user: User = Depends(get_current_user),
    db: Session = Depends(get_db),
):
    if not current_user:
        raise HTTPException(status_code=status.HTTP_401_UNAUTHORIZED, detail="Not authenticated")

    room_service = RoomService(db)
    room = room_service.get_room(room_id)
    if not room:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Room not found")

    if room.creator_id != current_user.id and current_user.role != "admin":
        raise HTTPException(status_code=status.HTTP_403_FORBIDDEN, detail="Not authorized")

    db.query(RoomTrack).filter(RoomTrack.room_id == room_id).delete(synchronize_session=False)
    db.commit()
    try:
        from app.playback.controller import stop_playback
        stop_playback(room_id)
    except Exception:
        # controller unavailable — do not mutate playback state here
        print(f"⚠️ [router] controller.stop_playback unavailable for room {room_id}")

    # Broadcast queue update to all WS clients
    try:
        asyncio.create_task(_broadcast_queue_update(room_id, db))
    except Exception as e:
        print(f"⚠️ [router] broadcast_queue_update after clear failed: {e}")


@router.put("/{room_id}/tracks/reorder")
def reorder_room_tracks(
    room_id: int,
    order: List[int] = Body(...),  # list of track IDs in new order
    current_user: User = Depends(get_current_user),
    db: Session = Depends(get_db),
):
    if not current_user:
        raise HTTPException(status_code=status.HTTP_401_UNAUTHORIZED, detail="Not authenticated")

    room_service = RoomService(db)
    room = room_service.get_room(room_id)
    if not room:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Room not found")

    # Update order for each track
    for idx, track_id in enumerate(order):
        track = db.query(RoomTrack).filter(
            RoomTrack.id == track_id,
            RoomTrack.room_id == room_id,
        ).first()
        if track:
            track.order = idx
    db.commit()

    # Broadcast queue update to all WS clients
    try:
        asyncio.create_task(_broadcast_queue_update(room_id, db))
    except Exception as e:
        print(f"⚠️ [router] broadcast_queue_update after reorder failed: {e}")

    return {"ok": True, "room_id": room_id}


# ────────────── Lobby (pre-join state) & Cover upload ──────────────

@router.get("/{room_id}/lobby")
def get_room_lobby(
    room_id: int,
    db: Session = Depends(get_db),
):
    """Лёгкое состояние комнаты для экрана подключения.

    Возвращает: можно ли заходить (`can_join`), причину запрета (`reason`),
    обложку, описание, число пользователей и треков. Не делает тяжёлых
    запросов к провайдерам, не запускает плеер.
    """
    room_service = RoomService(db)
    room = room_service.get_room(room_id)
    if not room:
        return {
            "exists": False,
            "can_join": False,
            "reason": "not_found",
            "message": "Комната не найдена",
        }

    is_active = bool(getattr(room, "is_active", True))
    track_count = (
        db.query(RoomTrack).filter(RoomTrack.room_id == room_id).count()
    )
    users = room_service.get_room_users(room_id)
    user_count = len(users)
    max_users = getattr(room, "max_users", None) or 50
    requires_password = room.room_type == "private" and bool(room.password_hash)

    can_join = True
    reason = None
    message = None
    if not is_active:
        can_join, reason, message = False, "inactive", "Комната неактивна"
    elif user_count >= max_users:
        can_join, reason, message = False, "full", "Комната заполнена"

    return {
        "exists": True,
        "can_join": can_join,
        "reason": reason,
        "message": message,
        "id": room.id,
        "name": room.name,
        "description": room.description,
        "cover_url": getattr(room, "cover_url", None),
        "genre": getattr(room, "genre", None),
        "is_active": is_active,
        "is_playing": bool(getattr(room, "is_playing", False)),
        "user_count": user_count,
        "max_users": max_users,
        "track_count": track_count,
        "owner_id": getattr(room, "creator_id", None),
        "created_at": room.created_at,
        "requires_password": requires_password,
        "room_type": room.room_type or "public",
    }


@router.post("/{room_id}/cover")
async def upload_room_cover(
    room_id: int,
    file: UploadFile = File(...),
    current_user: User = Depends(get_current_user),
    db: Session = Depends(get_db),
):
    """Загрузить обложку комнаты (только владелец/админ)."""
    if not current_user:
        raise HTTPException(
            status_code=status.HTTP_401_UNAUTHORIZED, detail="Not authenticated"
        )
    room_service = RoomService(db)
    room = room_service.get_room(room_id)
    if not room:
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND, detail="Room not found"
        )
    if getattr(room, "creator_id", None) != current_user.id and current_user.role != "admin":
        raise HTTPException(
            status_code=status.HTTP_403_FORBIDDEN,
            detail="Not authorized to update this room",
        )

    suffix = Path(file.filename or "").suffix.lower() or ".jpg"
    if suffix not in {".jpg", ".jpeg", ".png", ".webp", ".gif"}:
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail=f"Unsupported image type: {suffix}",
        )
    contents = await file.read()
    if not contents:
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST, detail="Empty file"
        )
    if len(contents) > 5 * 1024 * 1024:
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail="Image too large (max 5 MB)",
        )

    backend_root = Path(__file__).resolve().parents[3]
    covers_dir = backend_root / "static" / "uploads" / "room-covers"
    covers_dir.mkdir(parents=True, exist_ok=True)

    fname = f"room_{room.id}_{uuid4().hex}{suffix}"
    out = covers_dir / fname
    with open(out, "wb") as f:
        f.write(contents)
    public_url = f"/static/uploads/room-covers/{fname}"

    room.cover_url = public_url
    db.commit()
    return {"success": True, "cover_url": public_url}


@router.post("/upload-cover")
async def upload_cover_unbound(
    file: UploadFile = File(...),
    current_user: User = Depends(get_current_user),
):
    """Загрузить обложку для будущей комнаты (используется в модалке создания).

    Возвращает публичный URL, который потом передаётся в `cover_url`
    при `POST /rooms/`.
    """
    if not current_user:
        raise HTTPException(
            status_code=status.HTTP_401_UNAUTHORIZED, detail="Not authenticated"
        )

    suffix = Path(file.filename or "").suffix.lower() or ".jpg"
    if suffix not in {".jpg", ".jpeg", ".png", ".webp", ".gif"}:
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail=f"Unsupported image type: {suffix}",
        )
    contents = await file.read()
    if not contents:
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST, detail="Empty file"
        )
    if len(contents) > 5 * 1024 * 1024:
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail="Image too large (max 5 MB)",
        )

    backend_root = Path(__file__).resolve().parents[3]
    covers_dir = backend_root / "static" / "uploads" / "room-covers"
    covers_dir.mkdir(parents=True, exist_ok=True)

    fname = f"draft_{uuid4().hex}{suffix}"
    out = covers_dir / fname
    with open(out, "wb") as f:
        f.write(contents)
    return {"success": True, "cover_url": f"/static/uploads/room-covers/{fname}"}


@router.post("/", response_model=RoomResponse, status_code=status.HTTP_201_CREATED)
def create_room(
    room_data: RoomCreate,
    current_user: User = Depends(get_current_user),
    db: Session = Depends(get_db)
):
    """Create a new room."""
    if not current_user:
        raise HTTPException(
            status_code=status.HTTP_401_UNAUTHORIZED,
            detail="Not authenticated"
        )
    
    room_service = RoomService(db)
    room = room_service.create_room(
        name=room_data.name,
        owner=current_user,
        description=room_data.description,
        room_type=room_data.room_type,
        max_users=room_data.max_users
    )
    # Дополнительные поля сразу после создания
    extras = {}
    if room_data.cover_url is not None:
        extras["cover_url"] = room_data.cover_url
    if room_data.genre is not None:
        extras["genre"] = room_data.genre
    if room_data.room_type:
        extras["room_type"] = room_data.room_type
    
    # Хешировать пароль для приватных комнат
    if room_data.password and room_data.room_type == "private":
        from app.domains.auth.service import AuthService
        auth_service = AuthService(db)
        extras["password_hash"] = auth_service.hash_password(room_data.password)
    
    if extras:
        for k, v in extras.items():
            setattr(room, k, v)
        db.commit()
        db.refresh(room)
    return _serialize_room(room)

@router.get("/{room_id}", response_model=RoomDetailResponse)
def get_room(room_id: int, db: Session = Depends(get_db)):
    """Get room details."""
    room_service = RoomService(db)
    room = room_service.get_room(room_id)
    if not room:
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND,
            detail="Room not found"
        )
    
    room_users = room_service.get_room_users(room_id)
    users = [
        RoomUserResponse(
            id=user.id,
            username=user.username,
            display_name=getattr(user, "display_name", None),
            avatar_url=getattr(user, "avatar_url", None),
            role=getattr(user, "role", "user"),
        )
        for user in room_users
    ]
    
    return RoomDetailResponse(
        id=room.id,
        name=room.name,
        description=room.description,
        room_type=getattr(room, "room_type", None) or "public",
        owner_id=getattr(room, "creator_id", None),
        is_active=bool(getattr(room, "is_active", True)),
        max_users=getattr(room, "max_users", None) or 50,
        current_users=len(users),
        created_at=room.created_at,
        updated_at=room.updated_at,
        users=users,
    )

@router.put("/{room_id}", response_model=RoomResponse)
def update_room(
    room_id: int,
    room_data: RoomUpdate,
    current_user: User = Depends(get_current_user),
    db: Session = Depends(get_db)
):
    """Update a room."""
    if not current_user:
        raise HTTPException(
            status_code=status.HTTP_401_UNAUTHORIZED,
            detail="Not authenticated"
        )
    
    room_service = RoomService(db)
    room = room_service.get_room(room_id)
    if not room:
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND,
            detail="Room not found"
        )
    
    if getattr(room, "creator_id", None) != current_user.id and current_user.role != "admin":
        raise HTTPException(
            status_code=status.HTTP_403_FORBIDDEN,
            detail="Not authorized to update this room"
        )
    
    # Хешировать новый пароль если он предоставлен
    update_kwargs = {
        "name": room_data.name,
        "description": room_data.description,
        "room_type": room_data.room_type,
        "max_users": room_data.max_users,
        "is_active": room_data.is_active,
        "cover_url": room_data.cover_url,
        "genre": room_data.genre,
    }
    
    if room_data.password is not None:
        auth_service = AuthService(db)
        if room_data.password.strip():
            update_kwargs["password_hash"] = auth_service.hash_password(room_data.password)
        else:
            # Пустой пароль = удалить пароль
            update_kwargs["password_hash"] = None
    
    updated_room = room_service.update_room(room_id, **update_kwargs)
    return _serialize_room(updated_room)

@router.delete("/{room_id}", status_code=status.HTTP_204_NO_CONTENT)
def delete_room(
    room_id: int,
    current_user: User = Depends(get_current_user),
    db: Session = Depends(get_db)
):
    """Delete a room."""
    if not current_user:
        raise HTTPException(
            status_code=status.HTTP_401_UNAUTHORIZED,
            detail="Not authenticated"
        )
    
    room_service = RoomService(db)
    room = room_service.get_room(room_id)
    if not room:
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND,
            detail="Room not found"
        )
    
    if getattr(room, "creator_id", None) != current_user.id and current_user.role != "admin":
        raise HTTPException(
            status_code=status.HTTP_403_FORBIDDEN,
            detail="Not authorized to delete this room"
        )
    
    room_service.delete_room(room_id)
    return None
