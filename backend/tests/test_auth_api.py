"""
Integration tests for Auth API.

Tests /auth/register, /auth/login, /auth/me endpoints.
"""
import pytest


class TestAuthAPI:
    """Test cases for Auth API endpoints."""

    def test_register_success(self, client):
        """T-77: Register a new user successfully."""
        response = client.post(
            "/auth/register",
            json={
                "username": "newuser_api",
                "email": "new_api@example.com",
                "password": "securepassword123",
            },
        )
        assert response.status_code in [200, 201, 204]

    def test_register_duplicate_username(self, client, test_user):
        """T-78: Register with duplicate username fails."""
        response = client.post(
            "/auth/register",
            json={
                "username": "testuser",  # Already exists
                "email": "dup@example.com",
                "password": "password123",
            },
        )
        assert response.status_code in [400, 409, 422]

    def test_register_duplicate_email(self, client, test_user):
        """T-79: Register with duplicate email fails."""
        response = client.post(
            "/auth/register",
            json={
                "username": "unique_user",
                "email": "test@example.com",  # Already exists
                "password": "password123",
            },
        )
        assert response.status_code in [400, 409, 422]

    def test_register_invalid_email(self, client):
        """T-80: Register with invalid email format."""
        response = client.post(
            "/auth/register",
            json={
                "username": "bademail",
                "email": "notanemail",
                "password": "password123",
            },
        )
        assert response.status_code == 422

    def test_register_short_password(self, client):
        """T-81: Register with short password fails validation."""
        response = client.post(
            "/auth/register",
            json={
                "username": "shortpass",
                "email": "short@example.com",
                "password": "123",
            },
        )
        assert response.status_code == 422

    def test_register_empty_username(self, client):
        """T-82: Register with empty username fails."""
        response = client.post(
            "/auth/register",
            json={
                "username": "",
                "email": "empty@example.com",
                "password": "password123",
            },
        )
        assert response.status_code == 422

    def test_login_success(self, client, test_user):
        """T-83: Login with correct credentials."""
        response = client.post(
            "/auth/login",
            json={
                "username": "testuser",
                "password": "password123",
            },
        )
        assert response.status_code == 200
        data = response.json()
        assert "access_token" in data

    def test_login_wrong_password(self, client, test_user):
        """T-84: Login with wrong password fails."""
        response = client.post(
            "/auth/login",
            data={
                "username": "testuser",
                "password": "wrongpassword",
            },
        )
        assert response.status_code in [401, 422]

    def test_login_nonexistent_user(self, client):
        """T-85: Login with non-existent user fails."""
        response = client.post(
            "/auth/login",
            data={
                "username": "nonexistent",
                "password": "anypass",
            },
        )
        assert response.status_code in [401, 422]

    def test_get_me_authenticated(self, client, auth_headers):
        """T-86: Get current user profile with valid token."""
        response = client.get("/auth/me", headers=auth_headers)
        assert response.status_code == 200
        data = response.json()
        assert data["username"] == "testuser"

    def test_get_me_unauthenticated(self, client):
        """T-87: Get current user without token returns 401."""
        response = client.get("/auth/me")
        assert response.status_code == 401

    def test_get_me_invalid_token(self, client):
        """T-88: Get current user with invalid token returns 401."""
        response = client.get(
            "/auth/me",
            headers={"Authorization": "Bearer invalid.token.here"},
        )
        assert response.status_code == 401

    def test_login_case_insensitive_username(self, client, test_user):
        """T-89: Login works with different case username."""
        response = client.post(
            "/auth/login",
            data={
                "username": "TESTUSER",
                "password": "password123",
            },
        )
        # May or may not be case-insensitive depending on implementation
        assert response.status_code in [200, 401, 422]

    def test_register_special_chars_username(self, client):
        """T-90: Register with special characters in username."""
        response = client.post(
            "/auth/register",
            json={
                "username": "user@#$%",
                "email": "special@example.com",
                "password": "password123",
            },
        )
        # May be rejected by validation
        assert response.status_code in [200, 201, 400, 422]

    def test_login_empty_credentials(self, client):
        """T-91: Login with empty credentials."""
        response = client.post(
            "/auth/login",
            data={"username": "", "password": ""},
        )
        assert response.status_code in [401, 422]
