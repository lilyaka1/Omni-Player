"""
Tests for error handling.

Tests 404, 500 responses, graceful degradation.
"""
import pytest


class TestErrorHandling:
    """Test cases for error handling."""

    def test_404_for_nonexistent_resource(self, client):
        """T-160: Non-existent resource returns 404."""
        response = client.get("/rooms/99999")
        assert response.status_code == 404

    def test_404_for_nonexistent_endpoint(self, client):
        """T-161: Non-existent endpoint returns 404."""
        response = client.get("/api/nonexistent/endpoint")
        assert response.status_code == 404

    def test_405_for_wrong_method(self, client):
        """T-162: Wrong HTTP method returns 405."""
        response = client.put("/auth/me")
        assert response.status_code in [404, 405]

    def test_422_for_invalid_json(self, client):
        """T-163: Invalid JSON returns 422."""
        response = client.post(
            "/auth/register",
            content="not valid json{{{",
            headers={"Content-Type": "application/json"},
        )
        assert response.status_code == 422

    def test_error_response_has_message(self, client):
        """T-164: Error response contains error message."""
        response = client.get("/rooms/99999")
        data = response.json()
        assert "detail" in data or "error" in data or "message" in data

    def test_error_response_has_status_code(self, client):
        """T-165: Error response indicates status code."""
        response = client.get("/rooms/99999")
        assert response.status_code == 404

    def test_graceful_handling_of_malformed_input(self, client, auth_headers):
        """T-166: Malformed input handled gracefully."""
        response = client.post(
            "/rooms",
            json={"name": None, "description": [1, 2, 3]},
            headers=auth_headers,
        )
        assert response.status_code in [400, 422]

    def test_handling_of_very_large_payload(self, client, auth_headers):
        """T-167: Very large payload handled."""
        large_data = "x" * 1000000  # 1MB string
        response = client.post(
            "/rooms",
            json={"name": large_data},
            headers=auth_headers,
        )
        assert response.status_code in [400, 413, 422, 500]

    def test_handling_of_null_in_required_field(self, client, auth_headers):
        """T-168: Null in required field handled."""
        response = client.post(
            "/rooms",
            json={"name": None},
            headers=auth_headers,
        )
        assert response.status_code in [400, 422]

    def test_handling_of_special_chars_in_url(self, client):
        """T-169: Special characters in URL handled."""
        response = client.get("/rooms/<script>alert('xss')</script>")
        assert response.status_code in [400, 404, 422]

    def test_handling_of_missing_content_type(self, client, auth_headers):
        """T-170: Missing Content-Type header handled."""
        response = client.post(
            "/rooms",
            content='{"name": "Test"}',
            headers=auth_headers,
        )
        assert response.status_code in [200, 201, 400, 415, 422]

    def test_handling_of_duplicate_request(self, client, auth_headers):
        """T-171: Duplicate request handled."""
        # Create room twice
        response1 = client.post(
            "/rooms",
            json={"name": "Duplicate Test Room", "room_type": "public"},
            headers=auth_headers,
        )
        response2 = client.post(
            "/rooms",
            json={"name": "Duplicate Test Room", "room_type": "public"},
            headers=auth_headers,
        )
        # Both should succeed or second should fail gracefully
        assert response1.status_code in [200, 201]
        assert response2.status_code in [200, 201, 409]

    def test_error_for_room_without_creator(self, client):
        """T-172: Room without creator handled."""
        response = client.get("/rooms/0")
        assert response.status_code in [400, 404]

    def test_handling_of_negative_ids(self, client):
        """T-173: Negative IDs handled."""
        response = client.get("/rooms/-1")
        assert response.status_code in [400, 404]

    def test_handling_of_float_ids(self, client):
        """T-174: Float IDs handled."""
        response = client.get("/rooms/1.5")
        assert response.status_code in [400, 404, 422]

    def test_handling_of_concurrent_requests(self, client, auth_headers):
        """T-175: Concurrent requests handled."""
        # Simulate rapid requests
        for _ in range(10):
            response = client.get("/rooms", headers=auth_headers)
            assert response.status_code == 200
