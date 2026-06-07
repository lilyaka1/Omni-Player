"""
Music Player API routes
"""
from fastapi import APIRouter, Depends, Header, HTTPException, Query, Request, status
from fastapi.responses import FileResponse, RedirectResponse, StreamingResponse
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
from app.room.providers.soundcloud import soundcloud_client
from app.services.track_availability import classify_soundcloud_metadata, AvailabilityStatus

settings = get_settings()
CHUNK_SIZE = 1024 * 1024


router = APIRouter(prefix="/api/player", tags=["player"])


def _sanitize_downloads_subdir(raw: Optional[str]) -> Optional[str]:
    if raw is None:
        return None
    value = str(raw).strip().replace("\\", "/")
    if not value:
        return None
    value = value.strip("/")
    if not value:
        return None
    # Запрещаем выход из корневой папки downloads.
    if ".." in value or value.startswith("/"):
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail="downloads_dir must be a relative folder inside downloads",
        )
    return value


def _resolve_user_downloads_dir(current_user: User) -> Path:
    base_downloads = Path(settings.DOWNLOADS_DIR).resolve()
    user_subdir = _sanitize_downloads_subdir(current_user.downloads_subdir) or f"users/{current_user.id}"
    path = (base_downloads / user_subdir).resolve()
    # Дополнительная защита от path traversal.
    if base_downloads not in path.parents and path != base_downloads:
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail="Resolved downloads path is outside downloads root",
        )
    path.mkdir(parents=True, exist_ok=True)
    return path


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
    # Lightweight pre-ingestion validation for SoundCloud links
    url = (request.url or '').strip()
    if 'soundcloud.com' in url or url.startswith('scsearch') or url.isdigit():
        # get raw metadata (no download)
        raw = await soundcloud_client.get_raw_track_info(url)
        avail = classify_soundcloud_metadata(raw)
        if avail != AvailabilityStatus.FULL:
            # Return friendly error to frontend
            raise HTTPException(
                status_code=status.HTTP_400_BAD_REQUEST,
                detail=f"Track not allowed for ingestion: {avail.value}",
            )
    try:
        user_downloads_dir = str(_resolve_user_downloads_dir(current_user))
        track = await service.add_track_to_library(
            current_user.id,
            request.url,
            target_downloads_dir=user_downloads_dir,
        )
        return {
            "success": True,
            "track": {
                "id": track.id,
                "title": track.title,
                "artist": track.artist,
                "duration": track.duration,
                "source": track.source,
                "source_page_url": track.source_page_url,
                "stream_url": track.stream_url,
                "thumbnail_url": track.thumbnail_url,
            }
        }
    except Exception as e:
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail=f"Failed to add track: {str(e)}"
        )


@router.post("/add-by-url")
async def add_to_library_legacy(
    request: AddTrackRequest,
    current_user: User = Depends(get_current_user),
    db: Session = Depends(get_db),
):
    """Legacy alias for frontend compatibility."""
    return await add_to_library(request=request, current_user=current_user, db=db)


@router.post("/library/upload")
async def upload_local_files(
    files: list[UploadFile] = File(...),
    current_user: User = Depends(get_current_user),
    db: Session = Depends(get_db)
):
    """Загрузить локальные аудиофайлы в персональную папку пользователя."""
    downloads_dir = _resolve_user_downloads_dir(current_user)

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
            processing_status='processing',
            processing_progress=0,
        )
        db.add(track)
        db.flush()

        # Finalize via state machine: mark as successfully ingested
        try:
            from app.services.ingest_state import complete_success
            complete_success(track.id, str(stored_path), None, None)
            # Keep the current session in sync with the background finalization.
            # `complete_success()` writes from a separate session, but this route
            # still holds a stale `track` instance marked as `processing`. If we
            # leave it unchanged, the final `db.commit()` below can overwrite the
            # ready state back to processing.
            track.local_file_path = str(stored_path)
            track.processing_status = 'ready'
            track.processing_progress = 100
        except Exception:
            # fallback: do NOT set track.stream_url or processing_status here.
            # Instead try to create a TrackAsset marking the file as ready so
            # playability remains governed by TrackAsset.status == 'ready'.
            try:
                from app.database.models import TrackAsset
                db.add(TrackAsset(track_id=track.id, local_path=str(stored_path), status='ready'))
                track.local_file_path = str(stored_path)
                track.processing_status = 'ready'
                track.processing_progress = 100
                db.commit()
            except Exception:
                db.rollback()
                print(f"⚠️ [player] fallback complete_success failed for track {track.id}")

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


# ==================== Track Metadata / Cover / Redownload ====================

class UpdateTrackMetaRequest(BaseModel):
    title: Optional[str] = None
    artist: Optional[str] = None
    album: Optional[str] = None
    genre: Optional[str] = None
    year: Optional[int] = None


def _ensure_user_owns_track(db: Session, user_id: int, track_id: int) -> Track:
    """Удостовериться, что трек есть в библиотеке пользователя.
    Возвращает Track, иначе бросает 404."""
    user_track = db.query(UserTrack).filter(
        UserTrack.user_id == user_id,
        UserTrack.track_id == track_id,
    ).first()
    if not user_track:
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND,
            detail="Track not found in your library",
        )
    track = db.query(Track).filter(Track.id == track_id).first()
    if not track:
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND, detail="Track not found"
        )
    return track


@router.patch("/library/{track_id}")
async def update_track_metadata(
    track_id: int,
    payload: UpdateTrackMetaRequest,
    current_user: User = Depends(get_current_user),
    db: Session = Depends(get_db),
):
    """Редактирование метаданных трека (только из своей библиотеки)."""
    track = _ensure_user_owns_track(db, current_user.id, track_id)

    data = payload.model_dump(exclude_unset=True)
    for k, v in data.items():
        if hasattr(track, k):
            setattr(track, k, v)
    db.commit()
    db.refresh(track)
    return {
        "success": True,
        "track": {
            "id": track.id,
            "title": track.title,
            "artist": track.artist,
            "album": track.album,
            "genre": track.genre,
            "year": track.year,
            "thumbnail_url": track.thumbnail_url,
        },
    }


@router.post("/library/{track_id}/cover")
async def upload_track_cover(
    track_id: int,
    file: UploadFile = File(...),
    current_user: User = Depends(get_current_user),
    db: Session = Depends(get_db),
):
    """Загрузить/заменить обложку трека (хранится в /static/uploads/covers)."""
    track = _ensure_user_owns_track(db, current_user.id, track_id)

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

    backend_root = Path(__file__).resolve().parents[2]
    covers_dir = backend_root / "static" / "uploads" / "covers"
    covers_dir.mkdir(parents=True, exist_ok=True)

    fname = f"track_{track.id}_{uuid4().hex}{suffix}"
    out = covers_dir / fname
    with open(out, "wb") as f:
        f.write(contents)

    public_url = f"/static/uploads/covers/{fname}"
    track.thumbnail_url = public_url
    db.commit()

    return {"success": True, "thumbnail_url": public_url}


@router.post("/library/{track_id}/redownload")
async def redownload_track(
    track_id: int,
    current_user: User = Depends(get_current_user),
    db: Session = Depends(get_db),
):
    """Повторно скачать аудио файл трека (если у трека есть source_page_url)."""
    track = _ensure_user_owns_track(db, current_user.id, track_id)

    if not track.source_page_url or track.source_page_url.startswith("local-upload://"):
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail="This track cannot be redownloaded (no source URL)",
        )

    service = TrackService(db)
    try:
        info = await service._extract_metadata(track.source_page_url)
        dl_res = await service._download_audio(track.source_page_url, info or {})
        if isinstance(dl_res, dict):
            local_path = dl_res.get('local_path')
        else:
            local_path = dl_res
    except Exception as e:
        raise HTTPException(
            status_code=status.HTTP_500_INTERNAL_SERVER_ERROR,
            detail=f"Redownload failed: {e}",
        )

    if not local_path or not os.path.exists(local_path):
        raise HTTPException(
            status_code=status.HTTP_500_INTERNAL_SERVER_ERROR,
            detail="Download did not produce a file",
        )

    track.local_file_path = local_path
    # Do NOT set track.stream_url here — playability must be determined by
    # TrackAsset.status == 'ready'. Try to finalize ingestion via complete_success.
    try:
        from app.services.ingest_state import complete_success
        complete_success(track.id, local_path, None, None)
    except Exception:
        # Fallback: persist local path only, do not expose a playable stream_url.
        db.commit()
        db.refresh(track)
        print(f"⚠️ [player] complete_success failed for redownload track {track.id}")
    return {
        "success": True,
        "track_id": track.id,
        "local_file_path": track.local_file_path,
        "stream_url": track.stream_url,
    }


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
        user_identifier = decode_token(raw_token)
        if user_identifier:
            if str(user_identifier).isdigit():
                current_user = db.query(User).filter(User.id == int(user_identifier)).first()
            if not current_user:
                current_user = db.query(User).filter(
                    (User.email == user_identifier) | (User.username == user_identifier)
                ).first()

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

    if not track:
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND,
            detail="Track not found"
        )

    local_path = track.local_file_path
    # Поддерживаем старые относительные пути вида downloads/file.mp3.
    if local_path and not os.path.isabs(local_path):
        candidate = os.path.join("/app", local_path)
        if os.path.exists(candidate):
            local_path = candidate

    # Если есть внешний stream_url — отдаём редирект, независимо от processing_status.
    if track.stream_url:
        stream_url = str(track.stream_url)
        if stream_url.startswith("http://") or stream_url.startswith("https://"):
            return RedirectResponse(url=stream_url, status_code=status.HTTP_307_TEMPORARY_REDIRECT)

    # Enforce status: only ready tracks with local file may be streamed
    if track.processing_status != 'ready':
        raise HTTPException(
            status_code=status.HTTP_409_CONFLICT,
            detail=f"Track not ready for streaming: {track.processing_status}"
        )

    if not local_path or not os.path.exists(local_path):
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND,
            detail="Audio file does not exist on disk"
        )

    # ── Быстрая валидация ffmpeg ──
    try:
        from app.room.ffmpeg import validate_audio_file
        v = validate_audio_file(local_path, timeout=8)
        if not v.get("ok"):
            print(f"⚠️ [get_audio_file] track={track_id}: audio broken — {v.get('error')}")
            raise HTTPException(
                status_code=status.HTTP_422_UNPROCESSABLE_ENTITY,
                detail=f"Audio file is corrupted or unreadable: {v.get('error', 'unknown error')}"
            )
        print(f"✅ [get_audio_file] track={track_id}: valid ({v.get('duration', '?')}s {v.get('codec')})")
    except HTTPException:
        raise
    except Exception as e:
        print(f"⚠️ [get_audio_file] validation error: {e}")
        # Не блокируем отдачу, если валидация не сработала

    file_size = os.path.getsize(local_path)
    media_type, _ = mimetypes.guess_type(local_path)
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
            file_chunk_generator(local_path, start, end),
            status_code=status.HTTP_206_PARTIAL_CONTENT,
            media_type=media_type,
            headers=headers,
        )
    
    return FileResponse(
        local_path,
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
    """Получить настройки загрузок текущего пользователя."""
    path = _resolve_user_downloads_dir(current_user)
    return {
        "downloads_dir": _sanitize_downloads_subdir(current_user.downloads_subdir) or f"users/{current_user.id}",
        "downloads_path": str(path),
    }


@router.post("/settings")
async def update_settings_endpoint(
    request: UpdateSettingsRequest,
    db: Session = Depends(get_db),
    current_user: User = Depends(get_current_user)
):
    """Обновить пользовательскую подпапку загрузок (внутри settings.DOWNLOADS_DIR)."""
    normalized = _sanitize_downloads_subdir(request.downloads_dir)
    if normalized is None:
        normalized = f"users/{current_user.id}"

    user = db.query(User).filter(User.id == current_user.id).first()
    if not user:
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND,
            detail="User not found",
        )

    user.downloads_subdir = normalized
    db.add(user)
    db.commit()
    db.refresh(user)

    resolved = _resolve_user_downloads_dir(user)
    
    return {
        "success": True,
        "downloads_dir": normalized,
        "downloads_path": str(resolved),
    }


# ==================== Search ====================

@router.get("/search")
async def search_tracks(
    q: str = Query(..., min_length=1, alias="q"),
    source: str = Query("youtube"),
    limit: int = Query(20, ge=1, le=50),
    current_user: User = Depends(get_current_user),
):
    """Совместимый endpoint поиска треков для фронтенда (/api/player/search?q=...&source=...)."""
    try:
        source_normalized = (source or "youtube").strip().lower()
        if source_normalized == "soundcloud":
            tracks = await tracks_service.search_soundcloud(q, limit=limit)
        elif source_normalized == "youtube":
            tracks = await tracks_service.search_youtube(q, limit=limit)
        else:
            raise HTTPException(
                status_code=status.HTTP_400_BAD_REQUEST,
                detail="Unsupported source. Use 'youtube' or 'soundcloud'.",
            )
        return {"results": tracks, "tracks": tracks}
    except HTTPException:
        raise
    except Exception as e:
        raise HTTPException(
            status_code=status.HTTP_500_INTERNAL_SERVER_ERROR,
            detail=f"Search failed: {str(e)}",
        )

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


@router.get("/tracks/{track_id}")
async def get_track_detail(
    track_id: int,
    current_user: User = Depends(get_current_user),
    db: Session = Depends(get_db)
):
    """Return track detail including processing status/progress."""
    # Ensure ownership
    user_track = db.query(UserTrack).filter(
        UserTrack.user_id == current_user.id,
        UserTrack.track_id == track_id
    ).first()
    if not user_track:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Track not found in your library")

    track = db.query(Track).filter(Track.id == track_id).first()
    if not track:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Track not found")

    return {
        "id": track.id,
        "title": track.title,
        "artist": track.artist,
        "duration": track.duration,
        "stream_url": track.stream_url,
        "thumbnail_url": track.thumbnail_url,
        "local_file_path": track.local_file_path,
        "processing_status": track.processing_status,
        "processing_progress": track.processing_progress,
    }


# ==================== Audio Validation ====================

@router.post("/validate/{track_id}")
async def validate_track_audio(
    track_id: int,
    current_user: User = Depends(get_current_user),
    db: Session = Depends(get_db),
):
    """Проверить аудиофайл трека на валидность (ffprobe).

    Фронтенд вызывает после загрузки local-файла или перед добавлением в очередь.
    """
    track = db.query(Track).filter(Track.id == track_id).first()
    if not track:
        raise HTTPException(status_code=404, detail="Track not found")

    # Допускаем проверку по library ownership или по source
    if track.source != SourceEnum.LOCAL and not track.local_file_path:
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail="Track has no local file to validate",
        )

    path = track.local_file_path
    if not path or not os.path.exists(path):
        return {
            "ok": False,
            "track_id": track_id,
            "error": "file_not_found",
            "is_broken": True,
        }

    try:
        from app.room.ffmpeg import validate_audio_file
        result = validate_audio_file(path, timeout=15)
        return {
            "ok": result.get("ok", False),
            "track_id": track_id,
            "duration": result.get("duration"),
            "codec": result.get("codec"),
            "bitrate": result.get("bitrate"),
            "error": result.get("error"),
            "is_broken": result.get("is_broken", False),
        }
    except Exception as e:
        raise HTTPException(status_code=500, detail=f"Validation failed: {e}")
