"""
Профили пользователей: соц-сетевая страница пользователя.

Содержит:
  • публичный/собственный просмотр профиля
  • обновление полей (display_name, bio, location, website)
  • загрузка/смена аватара
  • агрегации: лайкнутые треки (UserTrack), плейлисты (Playlist)
"""
from __future__ import annotations

import uuid
from pathlib import Path
from typing import List, Optional

from fastapi import APIRouter, Depends, HTTPException, UploadFile, File, status
from pydantic import BaseModel
from sqlalchemy.orm import Session

from app.core.dependencies import get_db, get_current_user
from app.database.models import User, UserTrack, Track, Playlist


router = APIRouter(prefix="/api/profiles", tags=["profiles"])


# ── allowed image extensions / size ──────────────────────────────────────
ALLOWED_IMAGE_EXT = {".jpg", ".jpeg", ".png", ".webp", ".gif"}
MAX_IMAGE_SIZE = 5 * 1024 * 1024  # 5 MB


def _backend_root() -> Path:
    # backend/app/domains/profiles/router.py -> .../backend
    return Path(__file__).resolve().parents[3]


def _avatars_dir() -> Path:
    p = _backend_root() / "static" / "uploads" / "avatars"
    p.mkdir(parents=True, exist_ok=True)
    return p


def _save_image(upload: UploadFile, dest_dir: Path, prefix: str) -> str:
    ext = Path(upload.filename or "").suffix.lower()
    if ext not in ALLOWED_IMAGE_EXT:
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail=f"Unsupported image type: {ext}",
        )
    contents = upload.file.read()
    if not contents:
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST, detail="Empty file"
        )
    if len(contents) > MAX_IMAGE_SIZE:
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail="Image too large (max 5 MB)",
        )
    fname = f"{prefix}_{uuid.uuid4().hex}{ext}"
    out = dest_dir / fname
    with open(out, "wb") as f:
        f.write(contents)
    # Возвращаем публичный URL (через /static mount в main.py)
    return f"/static/uploads/avatars/{fname}"


# ── schemas ──────────────────────────────────────────────────────────────


class ProfilePublic(BaseModel):
    id: int
    username: str
    display_name: Optional[str] = None
    avatar_url: Optional[str] = None
    bio: Optional[str] = None
    location: Optional[str] = None
    website: Optional[str] = None
    role: Optional[str] = None
    created_at: Optional[str] = None
    stats: dict


class ProfileUpdate(BaseModel):
    display_name: Optional[str] = None
    bio: Optional[str] = None
    location: Optional[str] = None
    website: Optional[str] = None


# ── helpers ──────────────────────────────────────────────────────────────


def _serialize_profile(db: Session, user: User) -> dict:
    likes_count = db.query(UserTrack).filter(UserTrack.user_id == user.id).count()
    playlists_count = (
        db.query(Playlist).filter(Playlist.owner_id == user.id).count()
    )
    return {
        "id": user.id,
        "username": user.username,
        "display_name": getattr(user, "display_name", None) or user.username,
        "avatar_url": getattr(user, "avatar_url", None),
        "bio": getattr(user, "bio", None),
        "location": getattr(user, "location", None),
        "website": getattr(user, "website", None),
        "role": getattr(user, "role", None),
        "created_at": user.created_at.isoformat() if user.created_at else None,
        "stats": {
            "likes": likes_count,
            "playlists": playlists_count,
        },
    }


def _serialize_track_for_profile(track: Track, user_track: UserTrack) -> dict:
    src = getattr(track, "source", None)
    if hasattr(src, "value"):
        src_str = src.value
    else:
        src_str = str(src) if src else "local"
    return {
        "id": track.id,
        "title": track.title,
        "artist": track.artist,
        "album": track.album,
        "duration": track.duration,
        "thumbnail_url": track.thumbnail_url,
        "source": src_str,
        "stream_url": track.stream_url,
        "local_file_path": track.local_file_path,
        "is_favorite": user_track.is_favorite,
        "added_at": user_track.added_at.isoformat() if user_track.added_at else None,
    }


# ── endpoints ────────────────────────────────────────────────────────────


@router.get("/me")
def get_my_profile(
    current_user: User = Depends(get_current_user),
    db: Session = Depends(get_db),
):
    if not current_user:
        raise HTTPException(
            status_code=status.HTTP_401_UNAUTHORIZED, detail="Not authenticated"
        )
    return _serialize_profile(db, current_user)


@router.put("/me")
def update_my_profile(
    payload: ProfileUpdate,
    current_user: User = Depends(get_current_user),
    db: Session = Depends(get_db),
):
    if not current_user:
        raise HTTPException(
            status_code=status.HTTP_401_UNAUTHORIZED, detail="Not authenticated"
        )

    data = payload.model_dump(exclude_unset=True)
    for k, v in data.items():
        if hasattr(current_user, k):
            setattr(current_user, k, v)
    db.commit()
    db.refresh(current_user)
    return _serialize_profile(db, current_user)


@router.post("/me/avatar")
async def upload_avatar(
    file: UploadFile = File(...),
    current_user: User = Depends(get_current_user),
    db: Session = Depends(get_db),
):
    if not current_user:
        raise HTTPException(
            status_code=status.HTTP_401_UNAUTHORIZED, detail="Not authenticated"
        )
    url = _save_image(file, _avatars_dir(), prefix=f"u{current_user.id}")
    current_user.avatar_url = url
    db.commit()
    return {"avatar_url": url}


@router.get("/by-username/{username}")
def get_profile_by_username(
    username: str,
    db: Session = Depends(get_db),
):
    user = db.query(User).filter(User.username == username).first()
    if not user:
        raise HTTPException(status_code=404, detail="User not found")
    return _serialize_profile(db, user)


@router.get("/{user_id}")
def get_profile(user_id: int, db: Session = Depends(get_db)):
    user = db.query(User).filter(User.id == user_id).first()
    if not user:
        raise HTTPException(status_code=404, detail="User not found")
    return _serialize_profile(db, user)


@router.get("/{user_id}/likes")
def get_user_likes(
    user_id: int,
    db: Session = Depends(get_db),
):
    """Все «лайки» = записи UserTrack пользователя (скачанное / сохранённое)."""
    user = db.query(User).filter(User.id == user_id).first()
    if not user:
        raise HTTPException(status_code=404, detail="User not found")

    rows = (
        db.query(Track, UserTrack)
        .join(UserTrack, UserTrack.track_id == Track.id)
        .filter(UserTrack.user_id == user_id)
        .order_by(UserTrack.added_at.desc())
        .all()
    )
    return {"items": [_serialize_track_for_profile(t, ut) for t, ut in rows]}


@router.get("/{user_id}/playlists")
def get_user_playlists(
    user_id: int,
    db: Session = Depends(get_db),
):
    user = db.query(User).filter(User.id == user_id).first()
    if not user:
        raise HTTPException(status_code=404, detail="User not found")

    playlists = (
        db.query(Playlist)
        .filter(Playlist.owner_id == user_id)
        .order_by(Playlist.created_at.desc())
        .all()
    )
    return {
        "items": [
            {
                "id": p.id,
                "name": p.name,
                "description": p.description,
                "thumbnail": p.thumbnail,
                "is_album": p.is_album,
                "track_count": p.track_count or 0,
                "is_public": p.is_public,
                "created_at": p.created_at.isoformat() if p.created_at else None,
            }
            for p in playlists
        ]
    }
