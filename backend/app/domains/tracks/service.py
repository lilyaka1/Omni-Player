"""Tracks domain service — SoundCloud/YouTube search and stream URL resolution."""
import asyncio
from typing import List, Dict, Optional
import yt_dlp

from app.room.providers.soundcloud import soundcloud_client


async def search_soundcloud(query: str, limit: int = 10) -> List[Dict]:
    """Поиск треков на SoundCloud."""
    results = await soundcloud_client.search_tracks(query, limit=min(limit, 50))
    tracks = []
    for track in results:
        track_page_url = track.get("track_page_url", "")
        tracks.append({
            "id": f"search_{track.get('id')}",
            "source_id": track.get("id"),
            "title": track.get("title", "Unknown"),
            "artist": track.get("artist", "Unknown"),
            "duration": track.get("duration"),
            "source": "soundcloud",
            "source_track_id": track_page_url,
            "url": track.get("url", ""),
            "thumbnail": track.get("thumbnail", ""),
            "genre": track.get("genre", ""),
            "track_page_url": track_page_url,
        })
    return tracks


async def search_youtube(query: str, limit: int = 10) -> List[Dict]:
    """Поиск треков на YouTube."""
    def _sync() -> List[Dict]:
        ydl_opts = {
            "quiet": True,
            "no_warnings": True,
            "extract_flat": "in_playlist",
            "skip_download": True,
        }
        tracks: List[Dict] = []
        with yt_dlp.YoutubeDL(ydl_opts) as ydl:
            info = ydl.extract_info(f"ytsearch{limit}:{query}", download=False)
            if info and "entries" in info:
                for entry in info["entries"][:limit]:
                    video_id = entry.get("id", "")
                    thumbnail = (
                        f"https://img.youtube.com/vi/{video_id}/mqdefault.jpg"
                        if video_id else ""
                    )
                    tracks.append({
                        "id": video_id,
                        "title": entry.get("title", "Unknown"),
                        "artist": entry.get("uploader", "Unknown Channel"),
                        "duration": entry.get("duration", 0),
                        "source_track_id": video_id,
                        "page_url": entry.get("url", ""),
                        "source": "youtube",
                        "thumbnail": thumbnail,
                        "description": entry.get("description", ""),
                    })
        return tracks

    return await asyncio.to_thread(_sync)


async def get_track_info(source_track_id: str) -> Optional[Dict]:
    """Получить полную информацию и stream URL трека с SoundCloud."""
    return await soundcloud_client.get_track_info(source_track_id)


async def get_youtube_stream_url(video_id: str) -> str:
    """Получить прямой stream URL для YouTube-видео."""
    ydl_opts = {
        "quiet": True,
        "no_warnings": True,
        "skip_download": True,
        "format": "best",
        "socket_timeout": 30,
    }
    try:
        with yt_dlp.YoutubeDL(ydl_opts) as ydl:
            info = ydl.extract_info(
                f"https://youtube.com/watch?v={video_id}", download=False
            )
            if info:
                if "url" in info:
                    return info["url"]
                if info.get("formats"):
                    url = info["formats"][0].get("url", "")
                    if url:
                        return url
    except Exception as e:
        print(f"⚠️ YouTube extraction failed: {e}")
    return ""
