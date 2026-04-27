"""
Stream routing - handle audio streaming endpoints
"""
from fastapi import APIRouter, Depends, HTTPException, status
from fastapi.responses import FileResponse
from sqlalchemy.orm import Session
from app.database.session import get_db
from app.database.models import Room, Track, RoomTrack
from pathlib import Path

router = APIRouter(prefix="/stream", tags=["stream"])

@router.get("/room/{room_id}/status")
async def get_stream_status(room_id: int, db: Session = Depends(get_db)):
    """Get room broadcast status"""
    from app.room.manager import room_manager
    
    room = db.query(Room).filter(Room.id == room_id).first()
    if not room:
        raise HTTPException(status_code=404, detail="Room not found")
    
    # Check if broadcast is actually running
    is_live = room_manager.is_live(room_id)
    bc = room_manager.broadcasts.get(room_id)
    
    response = {
        "live": is_live,
        "active": is_live,
        "is_active": is_live,
        "room_id": room_id,
    }
    
    # Add current track info if available
    if bc and bc.current_track_title:
        response["current_track"] = bc.current_track_title
    
    # Add listener count
    if bc:
        response["listeners"] = len(bc.listeners)
    
    return response

@router.get("/room/{room_id}/stream")
async def get_room_stream(room_id: int, db: Session = Depends(get_db)):
    """
    Stream live broadcast for a room.
    Returns HTTP audio stream from FFmpeg broadcast.
    """
    from fastapi.responses import StreamingResponse
    from app.room.manager import room_manager
    import time
    
    print(f"🎧 [STREAM] Room {room_id}: New connection request")
    
    room = db.query(Room).filter(Room.id == room_id).first()
    if not room:
        print(f"❌ [STREAM] Room {room_id}: Not found in database")
        raise HTTPException(status_code=404, detail="Room not found")
    
    print(f"📊 [STREAM] Room {room_id}: DB state - is_playing={room.is_playing}, current_track_id={room.now_playing_track_id}")
    
    # Check if broadcast is running
    is_live = room_manager.is_live(room_id)
    print(f"📡 [STREAM] Room {room_id}: Broadcast is_live={is_live}")
    
    if not is_live:
        print(f"⚠️ [STREAM] Room {room_id}: Broadcast not started, returning 503")
        raise HTTPException(
            status_code=status.HTTP_503_SERVICE_UNAVAILABLE,
            detail="Broadcast not started yet"
        )
    
    # Get broadcast state
    bc = room_manager.broadcasts.get(room_id)
    if not bc or not bc.running:
        print(f"⚠️ [STREAM] Room {room_id}: Broadcast state invalid (bc={bc}, running={bc.running if bc else 'N/A'})")
        raise HTTPException(
            status_code=status.HTTP_503_SERVICE_UNAVAILABLE,
            detail="Broadcast not available"
        )
    
    print(f"✅ [STREAM] Room {room_id}: Starting stream (current_track='{bc.current_track_title}', listeners={len(bc.listeners)})")
    
    # Stream from broadcast buffer
    start_time = time.time()
    chunks_sent = 0
    bytes_sent = 0
    
    async def stream_generator():
        nonlocal chunks_sent, bytes_sent
        try:
            print(f"🎵 [STREAM] Room {room_id}: Generator started, subscribing to broadcast")
            async for chunk in bc.subscribe():
                yield chunk
                chunks_sent += 1
                bytes_sent += len(chunk)
                
                # Log every 100 chunks (~50 seconds at 128kbps)
                if chunks_sent % 100 == 0:
                    elapsed = time.time() - start_time
                    print(f"📈 [STREAM] Room {room_id}: Sent {chunks_sent} chunks ({bytes_sent/1024:.1f}KB) in {elapsed:.1f}s")
        except Exception as e:
            elapsed = time.time() - start_time
            print(f"❌ [STREAM] Room {room_id}: Error after {elapsed:.1f}s, {chunks_sent} chunks: {e}")
            import traceback
            traceback.print_exc()
        finally:
            elapsed = time.time() - start_time
            print(f"🔌 [STREAM] Room {room_id}: Connection closed after {elapsed:.1f}s ({chunks_sent} chunks, {bytes_sent/1024:.1f}KB)")
    
    return StreamingResponse(
        stream_generator(),
        media_type="audio/mpeg",
        headers={
            "Cache-Control": "no-cache, no-store, must-revalidate",
            "Pragma": "no-cache",
            "Expires": "0",
            "X-Content-Type-Options": "nosniff",
        }
    )

@router.get("/room/{room_id}/hls/playlist.m3u8")
async def get_hls_playlist(room_id: int, db: Session = Depends(get_db)):
    """
    Get HLS playlist for room.
    Returns .m3u8 playlist file for HLS streaming.
    """
    from app.room.hls import hls_manager
    
    print(f"📺 [HLS] Room {room_id}: Playlist request")
    
    room = db.query(Room).filter(Room.id == room_id).first()
    if not room:
        raise HTTPException(status_code=404, detail="Room not found")
    
    # Check if HLS transcoding is running
    if not hls_manager.is_transcoding(room_id):
        print(f"⚠️ [HLS] Room {room_id}: HLS not started")
        raise HTTPException(
            status_code=status.HTTP_503_SERVICE_UNAVAILABLE,
            detail="HLS transcoding not started"
        )
    
    playlist_path = hls_manager.get_playlist_path(room_id)
    if not playlist_path or not Path(playlist_path).exists():
        print(f"❌ [HLS] Room {room_id}: Playlist not found")
        raise HTTPException(status_code=404, detail="Playlist not found")
    
    print(f"✅ [HLS] Room {room_id}: Serving playlist")
    return FileResponse(
        playlist_path,
        media_type="application/vnd.apple.mpegurl",
        headers={
            "Cache-Control": "no-cache, no-store, must-revalidate",
            "Pragma": "no-cache",
            "Expires": "0",
        }
    )

@router.get("/room/{room_id}/hls/{segment_name}")
async def get_hls_segment(room_id: int, segment_name: str, db: Session = Depends(get_db)):
    """
    Get HLS segment file.
    Returns .ts segment file for HLS streaming.
    """
    from app.room.hls import hls_manager
    
    # Validate segment name (security)
    if not segment_name.endswith('.ts') or '/' in segment_name or '\\' in segment_name:
        raise HTTPException(status_code=400, detail="Invalid segment name")
    
    room = db.query(Room).filter(Room.id == room_id).first()
    if not room:
        raise HTTPException(status_code=404, detail="Room not found")
    
    # Get transcoder
    transcoder = hls_manager.transcoders.get(room_id)
    if not transcoder or not transcoder.output_dir:
        raise HTTPException(
            status_code=status.HTTP_503_SERVICE_UNAVAILABLE,
            detail="HLS transcoding not available"
        )
    
    segment_path = transcoder.output_dir / segment_name
    if not segment_path.exists():
        raise HTTPException(status_code=404, detail="Segment not found")
    
    return FileResponse(
        str(segment_path),
        media_type="video/mp2t",
        headers={
            "Cache-Control": "public, max-age=31536000",  # Сегменты можно кэшировать
        }
    )

@router.get("/queue/{room_id}")
async def get_room_queue(room_id: int, db: Session = Depends(get_db)):
    """Get room track queue"""
    room = db.query(Room).filter(Room.id == room_id).first()
    if not room:
        raise HTTPException(status_code=404, detail="Room not found")
    
    room_tracks = (
        db.query(RoomTrack)
        .filter(RoomTrack.room_id == room_id)
        .order_by(RoomTrack.order)
        .all()
    )
    
    tracks = []
    for rt in room_tracks:
        track = rt.track
        if track:
            tracks.append({
                "id": track.id,
                "title": track.title,
                "artist": track.artist,
                "duration": track.duration,
                "stream_url": track.stream_url,
                "thumbnail_url": track.thumbnail_url,
            })
    
    return {"tracks": tracks}