"""
Tracks domain router — поиск треков, proxy, стриминг комнат.
Все эндпоинты под /stream (обратная совместимость с клиентом).
"""
import asyncio
from typing import Optional

from fastapi import APIRouter, Depends, HTTPException, Query
from fastapi.responses import StreamingResponse
from sqlalchemy.orm import Session

from app.database.session import get_db
from app.database.models import RoomTrack
from app.room.providers.soundcloud import soundcloud_client
from app.domains.tracks import service

router = APIRouter(prefix="/stream", tags=["tracks"])


# ── Поиск ─────────────────────────────────────────────────────────────

@router.get("/search/soundcloud")
async def search_soundcloud(
    query: str = Query(..., min_length=1),
    limit: int = Query(10, ge=1, le=50),
):
    """Поиск треков на SoundCloud."""
    print(f"🔍 SoundCloud: '{query}' (лимит: {limit})")
    try:
        tracks = await service.search_soundcloud(query, limit=limit)
        print(f"📊 Вернул {len(tracks)} результатов")
        return {"tracks": tracks}
    except Exception as e:
        print(f"❌ Ошибка поиска: {e}")
        raise HTTPException(status_code=500, detail=str(e))


# ── Queue info ────────────────────────────────────────────────────────



@router.get("/queue/{room_id}")
def get_room_queue(room_id: int, db: Session = Depends(get_db)):
    """Список треков в очереди комнаты."""
    tracks = db.query(RoomTrack).filter(RoomTrack.room_id == room_id).order_by(RoomTrack.order).all()
    return {
        "tracks": [
            {
                "id": t.id,
                "title": t.title,
                "artist": t.artist,
                "duration": t.duration,
                "thumbnail": t.thumbnail or "",
                "genre": t.genre or "",
                "added_by": t.added_by.username if t.added_by else "Unknown",
            }
            for t in tracks
        ]
    }


# ── Room broadcast endpoints ──────────────────────────────────────────

@router.get("/room/{room_id}/status")
async def get_room_broadcast_status(room_id: int):
    """Статус broadcast для комнаты."""
    from app.room.manager import room_manager
    bc = room_manager.broadcasts.get(room_id)
    if bc and bc.running:
        return {
            "live": True,
            "room_id": room_id,
            "current_track": bc.current_track_title,
            "listeners": len(bc.listeners),
            "stream_url": f"/stream/room/{room_id}/stream",
        }
    return {"live": False, "room_id": room_id}


@router.get("/room/{room_id}/stream")
async def stream_room_audio(room_id: int, db: Session = Depends(get_db)):
    """
    Подключить слушателя к broadcast-потоку комнаты.
    Все слушатели получают один и тот же поток в реальном времени.
    """
    import time as _time
    _t0 = _time.perf_counter()
    print(f"\n⏱  [stream] room {room_id} — listener connecting")

    from app.database.models import Room
    from app.room.manager import room_manager
    from app.database.session import SessionLocal

    # Читаем БД и СРАЗУ закрываем соединение — нельзя держать DB-коннекцию
    # открытой на всё время стриминга (часы), иначе connection pool исчерпается
    # и сервер перестаёт отвечать на любые запросы.
    room_exists = False
    is_playing = False
    now_playing_id = None
    try:
        room = db.query(Room).filter(Room.id == room_id).first()
        if room:
            room_exists = True
            is_playing = room.is_playing
            now_playing_id = room.now_playing_track_id
    finally:
        db.close()

    if not room_exists:
        raise HTTPException(status_code=404, detail="Room not found")

    bc = room_manager.get_or_create(room_id)
    if not bc.running:
        if not is_playing or not now_playing_id:
            raise HTTPException(
                status_code=503,
                detail="Room is not playing. Admin must start playback first.",
            )
        print(f"⏱  [stream] +{((_time.perf_counter()-_t0)*1000):.0f}ms — auto-starting broadcast")
        await room_manager.start_room(room_id, SessionLocal, soundcloud_client)
        bc = room_manager.get_or_create(room_id)

    print(
        f"⏱  [stream] +{((_time.perf_counter()-_t0)*1000):.0f}ms — "
        f"listener registered (listeners={len(bc.listeners)+1})"
    )
    
    # Добавляем слушателя с защитой от DoS
    try:
        listener_queue = bc.add_listener()
    except RuntimeError as e:
        raise HTTPException(status_code=503, detail=str(e))
    
    _first_chunk = True

    async def audio_generator():
        nonlocal _first_chunk
        try:
            while True:
                try:
                    chunk = await asyncio.wait_for(listener_queue.get(), timeout=5.0)
                except asyncio.TimeoutError:
                    if not bc.running:
                        print(f"⏹️ Room {room_id}: broadcast stopped, closing listener")
                        break
                    continue
                if chunk is None:
                    print(f"🔇 Room {room_id}: broadcast_end signal received")
                    break
                if _first_chunk:
                    _first_chunk = False
                    print(
                        f"⏱  [stream] +{((_time.perf_counter()-_t0)*1000):.0f}ms — "
                        f"FIRST CHUNK (size={len(chunk)}b)"
                    )
                yield chunk
        except Exception as e:
            import traceback
            print(f"⚠️ audio_generator error room {room_id}: {e}\n{traceback.format_exc()}")
        finally:
            bc.remove_listener(listener_queue)
            print(f"👋 Room {room_id}: listener disconnected")

    return StreamingResponse(
        audio_generator(),
        media_type="audio/mpeg",
        headers={
            "Cache-Control": "no-cache, no-store",
            "X-Content-Type-Options": "nosniff",
            "Access-Control-Allow-Origin": "*",
            "Connection": "keep-alive",
            "X-Accel-Buffering": "no",
        },
    )
