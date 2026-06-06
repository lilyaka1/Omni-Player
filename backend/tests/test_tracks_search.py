import asyncio
import sys
import types


def test_search_soundcloud_maps_results(monkeypatch):
    yt_dlp_stub = types.SimpleNamespace(YoutubeDL=object)
    monkeypatch.setitem(sys.modules, "yt_dlp", yt_dlp_stub)

    from app.domains.tracks import service

    async def fake_search_tracks(query: str, limit: int = 10):
        return [
            {
                "id": "abc123",
                "title": "Demo Track",
                "artist": "Demo Artist",
                "duration": 123,
                "track_page_url": "https://soundcloud.com/demo/demo-track",
                "url": "https://stream.example/demo.mp3",
                "thumbnail": "https://img.example/demo.jpg",
                "genre": "demo",
                "availability": "FULL",
            }
        ]

    monkeypatch.setattr(service.soundcloud_client, "search_tracks", fake_search_tracks)

    results = asyncio.run(service.search_soundcloud("demo", limit=20))

    assert len(results) == 1
    assert results[0]["id"] == "search_abc123"
    assert results[0]["availability"] == "FULL"
    assert results[0]["source_track_id"] == "https://soundcloud.com/demo/demo-track"
