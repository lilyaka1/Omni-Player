"""
Unit tests for AuthService.

Tests password hashing, authentication, token creation/validation.
"""
import pytest
from datetime import timedelta
from app.domains.auth.service import AuthService, decode_token
from app.core.config import settings


class TestAuthService:
    """Test cases for AuthService."""

    def test_password_hashing(self, db_session):
        """T-01: Password should be hashed and verifiable."""
        auth = AuthService(db_session)
        password = "mysecretpassword"
        hashed = auth.get_password_hash(password)

        # Hashed password should be different from original
        assert hashed != password
        # Should verify correctly
        assert auth.verify_password(password, hashed) is True
        # Should reject wrong password
        assert auth.verify_password("wrongpassword", hashed) is False

    def test_create_user(self, db_session):
        """T-02: Create a new user successfully."""
        auth = AuthService(db_session)
        user = auth.create_user(
            username="newuser",
            email="new@example.com",
            password="password123"
        )

        assert user.id is not None
        assert user.username == "newuser"
        assert user.email == "new@example.com"
        assert user.password_hash != "password123"  # Should be hashed

    def test_get_user_by_username(self, db_session):
        """T-03: Find user by username."""
        auth = AuthService(db_session)
        auth.create_user(username="findme", email="find@example.com", password="pass123")

        found = auth.get_user_by_username("findme")
        assert found is not None
        assert found.username == "findme"

        # Should return None for non-existent user
        assert auth.get_user_by_username("nonexistent") is None

    def test_get_user_by_email(self, db_session):
        """T-04: Find user by email."""
        auth = AuthService(db_session)
        auth.create_user(username="emailluser", email="unique@example.com", password="pass123")

        found = auth.get_user_by_email("unique@example.com")
        assert found is not None
        assert found.email == "unique@example.com"

        assert auth.get_user_by_email("nonexistent@example.com") is None

    def test_authenticate_user_success(self, db_session):
        """T-05: Authenticate user with correct credentials."""
        auth = AuthService(db_session)
        auth.create_user(username="loginuser", email="login@example.com", password="correctpass")

        user = auth.authenticate_user("loginuser", "correctpass")
        assert user is not None
        assert user.username == "loginuser"

    def test_authenticate_user_wrong_password(self, db_session):
        """T-06: Authentication fails with wrong password."""
        auth = AuthService(db_session)
        auth.create_user(username="wrongpass", email="wrong@example.com", password="correctpass")

        user = auth.authenticate_user("wrongpass", "wrongpassword")
        assert user is None

    def test_authenticate_user_nonexistent(self, db_session):
        """T-07: Authentication fails for non-existent user."""
        auth = AuthService(db_session)
        user = auth.authenticate_user("nonexistent", "anypass")
        assert user is None

    def test_create_access_token(self, db_session):
        """T-08: Create valid JWT token."""
        auth = AuthService(db_session)
        token = auth.create_access_token(
            data={"sub": "123", "username": "testuser"}
        )

        assert token is not None
        assert isinstance(token, str)
        assert len(token) > 0

    def test_create_access_token_with_expiry(self, db_session):
        """T-09: Create token with custom expiry."""
        auth = AuthService(db_session)
        token = auth.create_access_token(
            data={"sub": "123"},
            expires_delta=timedelta(minutes=30)
        )

        assert token is not None

    def test_decode_token_success(self, db_session):
        """T-10: Decode valid token returns sub/email."""
        auth = AuthService(db_session)
        token = auth.create_access_token(data={"sub": "123", "username": "testuser"})

        result = decode_token(token)
        assert result == "123"

    def test_decode_token_invalid(self, db_session):
        """T-11: Decode invalid token returns None."""
        result = decode_token("invalid.token.here")
        assert result is None

    def test_decode_token_empty(self, db_session):
        """T-12: Decode empty token returns None."""
        assert decode_token("") is None
        assert decode_token(None) is None

    def test_authenticate_by_email_success(self, db_session):
        """T-13: Authenticate user by email."""
        auth = AuthService(db_session)
        auth.create_user(username="emailauth", email="auth@example.com", password="emailpass")

        user = auth.authenticate_user_by_email("auth@example.com", "emailpass")
        assert user is not None
        assert user.username == "emailauth"

    def test_authenticate_by_email_wrong_password(self, db_session):
        """T-14: Email authentication fails with wrong password."""
        auth = AuthService(db_session)
        auth.create_user(username="emailwrong", email="wrongemail@example.com", password="pass123")

        user = auth.authenticate_user_by_email("wrongemail@example.com", "wrongpass")
        assert user is None

    def test_get_user_by_id(self, db_session):
        """T-15: Get user by ID."""
        auth = AuthService(db_session)
        user = auth.create_user(username="iduser", email="id@example.com", password="pass123")

        found = auth.get_user_by_id(user.id)
        assert found is not None
        assert found.id == user.id

        assert auth.get_user_by_id(99999) is None
