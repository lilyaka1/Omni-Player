"""
Tracks domain router — поиск треков.
ТОЛЬКО поиск + metadata. НИКАКОГО stream.
Stream endpoint — только в app.stream.router.
"""
from fastapi import APIRouter, HTTPException, Query

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
