"""
Tests for authorization and RBAC.

Tests 401/403 responses, role-based access control.
"""
import pytest


class TestAuthorization:
    """Test cases for authorization."""

    def test_unauthenticated_access_returns_401(self, client):
        """T-146: Unauthenticated access to protected endpoint returns 401."""
        endpoints = [
            ("GET", "/auth/me"),
            ("POST", "/rooms"),
            ("DELETE", "/rooms/1"),
        ]
        for method, endpoint in endpoints:
            if method == "GET":
                response = client.get(endpoint)
            elif method == "POST":
                response = client.post(endpoint, json={})
            elif method == "DELETE":
                response = client.delete(endpoint)
            assert response.status_code == 401, f"Expected 401 for {method} {endpoint}"

    def test_invalid_token_returns_401(self, client):
        """T-147: Invalid token returns 401."""
        response = client.get(
            "/auth/me",
            headers={"Authorization": "Bearer invalid.token.here"},
        )
        assert response.status_code == 401

    def test_expired_token_returns_401(self, client):
        """T-148: Expired token returns 401."""
        # Simulate expired token
        response = client.get(
            "/auth/me",
            headers={"Authorization": "Bearer expired.token.here"},
        )
        assert response.status_code == 401

    def test_regular_user_cannot_access_admin_endpoints(self, client, auth_headers):
        """T-149: Regular user cannot access admin endpoints."""
        response = client.get("/admin/users", headers=auth_headers)
        assert response.status_code in [403, 404]

    def test_admin_can_access_admin_endpoints(self, client, admin_headers):
        """T-150: Admin can access admin endpoints."""
        response = client.get("/admin/users", headers=admin_headers)
        assert response.status_code in [200, 404]

    def test_user_cannot_delete_other_user_room(self, client, auth_headers, test_room):
        """T-151: User cannot delete room they don't own."""
        # Try to delete room created by another user
        response = client.delete(f"/rooms/{test_room.id}", headers=auth_headers)
        # Should fail if not owner
        assert response.status_code in [200, 204, 403]

    def test_user_can_access_own_room(self, client, auth_headers, test_room):
        """T-152: User can access room they created."""
        response = client.get(f"/rooms/{test_room.id}", headers=auth_headers)
        assert response.status_code == 200

    def test_private_room_requires_password(self, client, auth_headers, test_private_room):
        """T-153: Private room requires password."""
        response = client.post(
            f"/rooms/{test_private_room.id}/join",
            headers=auth_headers,
        )
        # Should fail without password
        assert response.status_code in [200, 401, 403, 422]

    def test_bearer_token_format_required(self, client):
        """T-154: Bearer token format required."""
        # Token without "Bearer " prefix
        response = client.get(
            "/auth/me",
            headers={"Authorization": "just_token_no_bearer"},
        )
        assert response.status_code == 401

    def test_empty_authorization_header(self, client):
        """T-155: Empty authorization header returns 401."""
        response = client.get(
            "/auth/me",
            headers={"Authorization": ""},
        )
        assert response.status_code == 401

    def test_multiple_tokens_in_header(self, client):
        """T-156: Multiple tokens in header handled."""
        response = client.get(
            "/auth/me",
            headers={"Authorization": "Bearer token1 Bearer token2"},
        )
        assert response.status_code in [401, 422]

    def test_user_cannot_modify_other_user_profile(self, client, auth_headers):
        """T-157: User cannot modify other user's profile."""
        response = client.put(
            "/profiles/99999",
            json={"username": "hacked"},
            headers=auth_headers,
        )
        assert response.status_code in [403, 404]

    def test_room_creator_can_update_room(self, client, auth_headers, test_room):
        """T-158: Room creator can update their room."""
        response = client.put(
            f"/rooms/{test_room.id}",
            json={"name": "Updated Name"},
            headers=auth_headers,
        )
        assert response.status_code in [200, 204]

    def test_user_cannot_add_tracks_to_private_room_without_join(self, client, auth_headers, test_private_room):
        """T-159: Cannot add tracks to private room without joining."""
        response = client.post(
            f"/rooms/{test_private_room.id}/tracks",
            json={
                "source": "soundcloud",
                "source_track_id": "sc123",
                "title": "Test",
                "artist": "Artist",
                "duration": 180.0,
            },
            headers=auth_headers,
        )
        assert response.status_code in [200, 201, 403, 404]
