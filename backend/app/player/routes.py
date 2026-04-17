"""
Music Player API routes
"""
from fastapi import APIRouter, Depends, Header, HTTPException, Query, Request, status
from fastapi.responses import FileResponse, StreamingResponse
from fastapi import UploadFile, File
from sqlalchemy.orm import Session
from typing import Optional
from pydantic import BaseModel
from datetime import datetime, timedelta
from pathlib import Path
from uuid import uuid4
import mimetypes
import os

from app.database.session import get_db
from app.core.dependencies import get_current_user
from app.database.models import User, Track, UserTrack, SourceEnum
from app.services.track_service import TrackService
from app.core.config import get_settings
from app.domains.tracks import service as tracks_service
from app.domains.auth.service import decode_token

settings = get_settings()
CHUNK_SIZE = 1024 * 1024


router = APIRouter(prefix="/api/player", tags=["player"])


# ==================== Schemas ====================

class AddTrackRequest(BaseModel):
    url: str


class ImportPlaylistRequest(BaseModel):
    playlist_url: str
    create_playlist: bool = True
    is_album: bool = False


class PlayTrackRequest(BaseModel):
    track_id: int


# ==================== Library Endpoints ====================

@router.get("/library")
async def get_library(
    skip: int = 0,
    limit: int = 100,
    current_user: User = Depends(get_current_user),
    db: Session = Depends(get_db)
):
    """Получить библиотеку пользователя"""
    service = TrackService(db)
    library = service.get_user_library(current_user.id, skip=skip, limit=limit)
    return {"tracks": library, "total": len(library)}


@router.post("/library")
async def add_to_library(
    request: AddTrackRequest,
    current_user: User = Depends(get_current_user),
    db: Session = Depends(get_db)
):
    """Добавить трек в библиотеку"""
    service = TrackService(db)
    try:
        track = await service.add_track_to_library(current_user.id, request.url)
        return {
            "success": True,
            "track": {
                "id": track.id,
                "title": track.title,
                "artist": track.artist,
                "duration": track.duration,
                "stream_url": track.stream_url,
                "thumbnail_url": track.thumbnail_url,
            }
        }
    except Exception as e:
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail=f"Failed to add track: {str(e)}"
        )


@router.post("/library/upload")
async def upload_local_files(
    files: list[UploadFile] = File(...),
    current_user: User = Depends(get_current_user),
    db: Session = Depends(get_db)
):
    """Загрузить локальные аудиофайлы в постоянную папку downloads."""
    downloads_dir = Path(settings.DOWNLOADS_DIR)
    downloads_dir.mkdir(parents=True, exist_ok=True)

    added_tracks = []

    for upload in files:
        if not upload.filename:
            continue

        original_name = Path(upload.filename).name
        suffix = Path(original_name).suffix
        if not suffix:
            guessed = mimetypes.guess_extension(upload.content_type or '')
            suffix = guessed or '.mp3'

        safe_stem = Path(original_name).stem.replace('/', '_').replace('\\', '_').replace('..', '_')
        stored_name = f"local_{uuid4().hex}_{safe_stem}{suffix}"
        stored_path = (downloads_dir / stored_name).resolve()

        contents = await upload.read()
        with open(stored_path, 'wb') as file_handle:
            file_handle.write(contents)

        track = Track(
            source=SourceEnum.LOCAL,
            source_track_id=uuid4().hex,
            source_page_url=f"local-upload://{original_name}",
            title=Path(original_name).stem or 'Local track',
            artist=current_user.username,
            duration=None,
            stream_url="pending://local-upload",
            stream_url_expires_at=datetime.utcnow() + timedelta(days=3650),
            thumbnail_url=None,
            bitrate=None,
            codec=suffix.lstrip('.') or 'mp3',
            local_file_path=str(stored_path),
        )
        db.add(track)
        db.flush()

        track.stream_url = f"/api/player/audio/{track.id}"

        user_track = UserTrack(user_id=current_user.id, track_id=track.id)
        db.add(user_track)
        added_tracks.append(track)

    db.commit()

    return {
        "success": True,
        "added": len(added_tracks),
        "tracks": [
            {
                "id": track.id,
                "title": track.title,
                "artist": track.artist,
                "duration": track.duration,
                "stream_url": track.stream_url,
                "thumbnail_url": track.thumbnail_url,
                "local_file_path": track.local_file_path,
            }
            for track in added_tracks
        ],
    }


@router.delete("/library/{track_id}")
async def remove_from_library(
    track_id: int,
    current_user: User = Depends(get_current_user),
    db: Session = Depends(get_db)
):
    """Удалить трек из библиотеки"""
    user_track = db.query(UserTrack).filter(
        UserTrack.user_id == current_user.id,
        UserTrack.track_id == track_id
    ).first()
    
    if not user_track:
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND,
            detail="Track not found in library"
        )
    
    db.delete(user_track)
    db.commit()
    return {"success": True, "message": "Track removed from library"}


# ==================== Track Endpoints ====================

@router.post("/tracks/play")
async def play_track(
    request: PlayTrackRequest,
    current_user: User = Depends(get_current_user),
    db: Session = Depends(get_db)
):
    """Увеличить счётчик воспроизведений"""
    service = TrackService(db)
    service.increment_play_count(current_user.id, request.track_id)
    return {"success": True}


# ==================== Playlist Endpoints ====================

@router.post("/playlists/import")
async def import_playlist(
    request: ImportPlaylistRequest,
    current_user: User = Depends(get_current_user),
    db: Session = Depends(get_db)
):
    """Импортировать плейлист"""
    service = TrackService(db)
    try:
        result = await service.import_playlist(
            request.playlist_url,
            current_user.id,
            create_playlist=request.create_playlist,
            is_album=request.is_album
        )
        return result
    except Exception as e:
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail=f"Failed to import playlist: {str(e)}"
        )


# ==================== Local Files ====================

@router.get("/audio/{track_id}")
async def get_audio_file(
    track_id: int,
    token: Optional[str] = Query(default=None),
    authorization: Optional[str] = Header(default=None),
    request: Request = None,
    db: Session = Depends(get_db)
):
    """Раздать локальный аудиофайл"""
    current_user = None

    bearer = authorization.split(" ")[-1] if authorization else None
    raw_token = bearer or token
    if raw_token:
        email = decode_token(raw_token)
        if email:
            current_user = db.query(User).filter(User.email == email).first()

    if not current_user:
        raise HTTPException(
            status_code=status.HTTP_401_UNAUTHORIZED,
            detail="Not authenticated",
        )

    # Проверить что трек в библиотеке пользователя
    user_track = db.query(UserTrack).filter(
        UserTrack.user_id == current_user.id,
        UserTrack.track_id == track_id
    ).first()
    
    if not user_track:
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND,
            detail="Track not found in your library"
        )
    
    track = db.query(Track).filter(Track.id == track_id).first()
    
    if not track or not track.local_file_path:
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND,
            detail="Audio file not found"
        )
    
    if not os.path.exists(track.local_file_path):
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND,
            detail="Audio file does not exist on disk"
        )

    file_size = os.path.getsize(track.local_file_path)
    media_type, _ = mimetypes.guess_type(track.local_file_path)
    media_type = media_type or "audio/mpeg"

    def file_chunk_generator(path: str, start: int, end: int):
        with open(path, "rb") as file_handle:
            file_handle.seek(start)
            remaining = end - start + 1
            while remaining > 0:
                chunk = file_handle.read(min(CHUNK_SIZE, remaining))
                if not chunk:
                    break
                remaining -= len(chunk)
                yield chunk

    range_header = request.headers.get("range") if request else None
    base_headers = {
        "Accept-Ranges": "bytes",
        "Cache-Control": "no-store",
    }

    if range_header and range_header.startswith("bytes="):
        range_value = range_header.replace("bytes=", "", 1).strip()
        start_str, end_str = (range_value.split("-", 1) + [""])[:2]

        try:
            start = int(start_str) if start_str else 0
            end = int(end_str) if end_str else file_size - 1
        except ValueError:
            raise HTTPException(
                status_code=status.HTTP_416_REQUESTED_RANGE_NOT_SATISFIABLE,
                detail="Invalid range header",
            )

        if start >= file_size or start < 0:
            raise HTTPException(
                status_code=status.HTTP_416_REQUESTED_RANGE_NOT_SATISFIABLE,
                detail="Range start out of bounds",
                headers={"Content-Range": f"bytes */{file_size}"},
            )

        end = min(end, file_size - 1)
        content_length = end - start + 1

        headers = {
            **base_headers,
            "Content-Range": f"bytes {start}-{end}/{file_size}",
            "Content-Length": str(content_length),
        }

        return StreamingResponse(
            file_chunk_generator(track.local_file_path, start, end),
            status_code=status.HTTP_206_PARTIAL_CONTENT,
            media_type=media_type,
            headers=headers,
        )
    
    return FileResponse(
        track.local_file_path,
        media_type=media_type,
        headers=base_headers,
    )


# ==================== Settings ====================

class UpdateSettingsRequest(BaseModel):
    downloads_dir: Optional[str] = None


@router.get("/settings")
async def get_settings_endpoint(
    current_user: User = Depends(get_current_user)
):
    """Получить настройки плеера"""
    return {
        "downloads_dir": settings.DOWNLOADS_DIR
    }


@router.post("/settings")
async def update_settings_endpoint(
    request: UpdateSettingsRequest,
    current_user: User = Depends(get_current_user)
):
    """Обновить настройки плеера (только для текущей сессии)"""
    if request.downloads_dir:
        settings.DOWNLOADS_DIR = request.downloads_dir
        # Создать папку если не существует
        os.makedirs(request.downloads_dir, exist_ok=True)
    
    return {
        "success": True,
        "downloads_dir": settings.DOWNLOADS_DIR
    }


# ==================== Search ====================

@router.get("/search/soundcloud")
async def search_soundcloud_tracks(
    query: str,
    limit: int = 10,
    current_user: User = Depends(get_current_user),
):
    """Поиск треков на SoundCloud"""
    try:
        tracks = await tracks_service.search_soundcloud(query, limit=limit)
        return {"tracks": tracks}
    except Exception as e:
        raise HTTPException(
            status_code=status.HTTP_500_INTERNAL_SERVER_ERROR,
            detail=f"Search failed: {str(e)}",
        )


@router.get("/search/youtube")
async def search_youtube_tracks(
    query: str,
    limit: int = 10,
    current_user: User = Depends(get_current_user),
):
    """Поиск треков на YouTube"""
    try:
        tracks = await tracks_service.search_youtube(query, limit=limit)
        return {"tracks": tracks}
    except Exception as e:
        raise HTTPException(
            status_code=status.HTTP_500_INTERNAL_SERVER_ERROR,
            detail=f"Search failed: {str(e)}",
        )
