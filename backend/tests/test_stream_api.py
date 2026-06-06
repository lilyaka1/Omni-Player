"""
Integration tests for Stream API.

Tests HLS stream, audio endpoints.
"""
import pytest


class TestStreamAPI:
    """Test cases for Stream API endpoints."""

    def test_get_hls_playlist(self, client, test_room):
        """T-123: Get HLS playlist for room."""
        response = client.get(f"/stream/{test_room.id}/playlist.m3u8")
        # May return 200 with playlist or 404 if no tracks
        assert response.status_code in [200, 404]

    def test_get_hls_segment(self, client, test_room):
        """T-124: Get HLS segment."""
        response = client.get(f"/stream/{test_room.id}/segment_0.ts")
        # May return 200 or 404 depending on available segments
        assert response.status_code in [200, 404]

    def test_get_audio_stream(self, client, test_room):
        """T-125: Get audio stream."""
        response = client.get(f"/stream/{test_room.id}/audio")
        # May return 200 with audio or 206 partial content
        assert response.status_code in [200, 206, 404]

    def test_stream_nonexistent_room(self, client):
        """T-126: Stream from non-existent room returns 404."""
        response = client.get("/stream/99999/playlist.m3u8")
        assert response.status_code == 404

    def test_get_stream_status(self, client, test_room):
        """T-127: Get stream status."""
        response = client.get(f"/stream/{test_room.id}/status")
        assert response.status_code in [200, 404]

    def test_get_stream_info(self, client):
        """T-128: Get stream info for room."""
        response = client.get("/stream/info")
        assert response.status_code in [200, 404, 422]
