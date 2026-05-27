from fastapi import APIRouter, Depends, HTTPException
from fastapi.responses import FileResponse, StreamingResponse, JSONResponse
from sqlalchemy.orm import Session
from app.database.models import Room, RoomTrack
from app.database.session import get_db
from pathlib import Path

router = APIRouter(prefix="/stream", tags=["stream"])

# project root — stream router читает файлы строго относительно него
BASE_DIR = Path(__file__).resolve().parents[3]


@router.get("/room/{room_id}/stream")
async def stream_endpoint(room_id: int, db: Session = Depends(get_db)):
    """
    Тупой файл-читатель.
    INPUT: room.now_playing_track_id
    OUTPUT: FileResponse | StreamingResponse | 404
    """
    room = db.query(Room).filter(Room.id == room_id).first()
    if not room:
        raise HTTPException(status_code=404, detail="Room not found")

    if room.now_playing_track_id is None:
        raise HTTPException(status_code=404, detail="No track playing")

    track = db.query(RoomTrack).filter(RoomTrack.id == room.now_playing_track_id).first()
    if not track:
        raise HTTPException(status_code=404, detail="Track not found")

    # Prefer TrackAsset.local_path for serving audio. Only serve assets in 'ready' state.
    # Try Track/TrackAsset first (case-insensitive source match)
    from app.database.models import Track, TrackAsset
    from sqlalchemy import func

    track_model = db.query(Track).filter(
        func.lower(Track.source) == func.lower(track.source),
        Track.source_track_id == track.source_track_id
    ).first()

    file_path = None

    if track_model:
        asset = (
            db.query(TrackAsset)
            .filter(TrackAsset.track_id == track_model.id, TrackAsset.status == 'ready')
            .order_by(TrackAsset.updated_at.desc())
            .first()
        )
        if asset and asset.local_path:
            fp = Path(asset.local_path)
            if fp.is_file():
                file_path = fp

    # Fallback: use RoomTrack.stream_url directly (SoundCloud CDN URL or local path)
    if not file_path and track.stream_url:
        if track.stream_url.startswith('http://') or track.stream_url.startswith('https://'):
            # Remote URL — proxy via httpx StreamingResponse
            import httpx
            try:
                headers = {"User-Agent": "Mozilla/5.0"}
                r = httpx.get(track.stream_url, headers=headers, follow_redirects=True, timeout=10.0)
                r.raise_for_status()
                return StreamingResponse(
                    r.iter_bytes(chunk_size=65536),
                    media_type=r.headers.get("content-type", "audio/mpeg"),
                    headers={"Cache-Control": "no-cache", "Pragma": "no-cache"},
                )
            except Exception as e:
                print(f"❌ Stream proxy error: {e}")
                raise HTTPException(status_code=502, detail="Upstream stream unavailable")
        else:
            fp = Path(track.stream_url)
            if fp.is_file():
                file_path = fp

    if not file_path:
        raise HTTPException(status_code=404, detail="Asset not ready")

    return FileResponse(
        str(file_path),
        media_type="audio/mpeg",
        headers={"Cache-Control": "no-cache", "Pragma": "no-cache"},
    )


@router.get("/room/{room_id}/status")
async def room_status(room_id: int, db: Session = Depends(get_db)):
    """
    Room state endpoint - returns current track info.
    """
    room = db.query(Room).filter(Room.id == room_id).first()
    if not room:
        raise HTTPException(status_code=404, detail="Room not found")

    if room.now_playing_track_id is None:
        return JSONResponse({"current_track": None, "room_id": room_id})

    track = db.query(RoomTrack).filter(RoomTrack.id == room.now_playing_track_id).first()
    if not track:
        return JSONResponse({"current_track": None, "room_id": room_id})

    return JSONResponse({
        "current_track": {
            "id": track.id,
            "title": track.title,
            "artist": track.artist,
            "duration": track.duration,
            "thumbnail": track.thumbnail or "",
            "stream_url": track.stream_url or "",
        },
        "room_id": room_id,
    })


@router.get("/queue/{room_id}")
async def room_queue(room_id: int, db: Session = Depends(get_db)):
    """
    Queue endpoint - returns all tracks in room.
    Frontend expects: { tracks: [...] } or just [...]
    """
    room = db.query(Room).filter(Room.id == room_id).first()
    if not room:
        raise HTTPException(status_code=404, detail="Room not found")

    tracks = db.query(RoomTrack).filter(RoomTrack.room_id == room_id).order_by(RoomTrack.order).all()

    track_list = [
        {
            "id": t.id,
            "title": t.title,
            "artist": t.artist,
            "duration": t.duration,
            "thumbnail": t.thumbnail or "",
            "order": t.order,
            "stream_url": t.stream_url or "",
            "source": t.source or "youtube",
            "source_track_id": t.source_track_id or "",
            "genre": t.genre or "",
        }
        for t in tracks
    ]
    
    # Return format that frontend expects: { tracks: [...] }
    return JSONResponse({"tracks": track_list})


@router.post("/room/{room_id}/start")
async def room_start(room_id: int, db: Session = Depends(get_db)):
    """Start playback - stub for frontend compatibility."""
    room = db.query(Room).filter(Room.id == room_id).first()
    if not room:
        raise HTTPException(status_code=404, detail="Room not found")
    return JSONResponse({"ok": True, "room_id": room_id})


@router.post("/room/{room_id}/stop")
async def room_stop(room_id: int, db: Session = Depends(get_db)):
    """Stop playback - stub for frontend compatibility."""
    room = db.query(Room).filter(Room.id == room_id).first()
    if not room:
        raise HTTPException(status_code=404, detail="Room not found")
    return JSONResponse({"ok": True, "room_id": room_id})


@router.get("/search/soundcloud")
async def search_soundcloud(query: str = None, limit: int = 20):
    """Search SoundCloud tracks - proxy to tracks service."""
    from app.domains.tracks.service import TracksService
    from app.database.session import SessionLocal
    from fastapi import Query as FastAPIQuery
    
    if not query or not query.strip():
        return JSONResponse({"tracks": []})
    
    db = SessionLocal()
    try:
        service = TracksService(db)
        tracks = await service.search_soundcloud(query.strip(), limit=min(limit, 50))
        return JSONResponse({"tracks": tracks})
    except Exception as e:
        print(f"❌ Search error: {e}")
        return JSONResponse({"tracks": [], "error": str(e)}, status_code=500)
    finally:
        db.close()
