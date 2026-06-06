"""
Common pytest fixtures for Omni-Player backend tests.

Provides:
- test database session with cleanup
- TestClient for API testing
- test users (regular + admin)
- test rooms
"""
import os
import sys
import pytest
from datetime import datetime, timedelta
from typing import Generator

from fastapi.testclient import TestClient

# Add backend to path
sys.path.insert(0, os.path.join(os.path.dirname(__file__), '..'))

# Isolate tests from shell/IDE environment before importing app settings.
os.environ["DEBUG"] = "false"
os.environ.setdefault("DATABASE_URL", "sqlite:///./backend/test_omni_player.db")
os.environ.setdefault("SECRET_KEY", "test-secret-key")

from app.database.session import SessionLocal, engine, Base
from app.database.models import User, UserRole, Room, RoomTrack, Track, TrackAsset, PlaybackSession
from app.domains.auth.service import AuthService
from app.main import app


# ──────────────────────────────────────────────────────────────────────────────
# Database fixtures
# ──────────────────────────────────────────────────────────────────────────────

@pytest.fixture(scope="function")
def db_session() -> Generator:
    """Create a fresh database session for each test."""
    # Create all tables
    Base.metadata.create_all(bind=engine)
    
    session = SessionLocal()
    try:
        session.query(PlaybackSession).delete()
        session.query(RoomTrack).delete()
        session.query(TrackAsset).delete()
        session.query(Track).delete()
        session.query(Room).delete()
        session.query(User).delete()
        session.commit()
        yield session
    finally:
        # Cleanup all data after test
        session.rollback()
        session.query(PlaybackSession).delete()
        session.query(RoomTrack).delete()
        session.query(TrackAsset).delete()
        session.query(Track).delete()
        session.query(Room).delete()
        session.query(User).delete()
        session.commit()
        session.close()


# ──────────────────────────────────────────────────────────────────────────────
# TestClient fixture
# ──────────────────────────────────────────────────────────────────────────────

@pytest.fixture
def client() -> Generator:
    """Create a TestClient for API testing."""
    Base.metadata.create_all(bind=engine)
    session = SessionLocal()
    try:
        session.query(PlaybackSession).delete()
        session.query(RoomTrack).delete()
        session.query(TrackAsset).delete()
        session.query(Track).delete()
        session.query(Room).delete()
        session.query(User).delete()
        session.commit()
    finally:
        session.close()
    with TestClient(app) as c:
        yield c
    # Cleanup
    session = SessionLocal()
    try:
        session.rollback()
        session.query(PlaybackSession).delete()
        session.query(RoomTrack).delete()
        session.query(TrackAsset).delete()
        session.query(Track).delete()
        session.query(Room).delete()
        session.query(User).delete()
        session.commit()
    finally:
        session.close()


# ──────────────────────────────────────────────────────────────────────────────
# User fixtures
# ──────────────────────────────────────────────────────────────────────────────

@pytest.fixture
def test_user(db_session) -> User:
    """Create a regular test user."""
    auth = AuthService(db_session)
    user = auth.create_user(
        username="testuser",
        email="test@example.com",
        password="password123"
    )
    return user


@pytest.fixture
def test_admin(db_session) -> User:
    """Create an admin test user."""
    user = User(
        username="adminuser",
        email="admin@example.com",
        password_hash=AuthService(db_session).get_password_hash("adminpass123"),
        role=UserRole.ADMIN.value,
    )
    db_session.add(user)
    db_session.commit()
    db_session.refresh(user)
    return user


@pytest.fixture
def user_token(test_user) -> str:
    """Get JWT token for regular user."""
    session = SessionLocal()
    try:
        auth = AuthService(session)
        token = auth.create_access_token(
            data={"sub": str(test_user.id), "username": test_user.username}
        )
        return token
    finally:
        session.close()


@pytest.fixture
def admin_token(test_admin) -> str:
    """Get JWT token for admin user."""
    session = SessionLocal()
    try:
        auth = AuthService(session)
        token = auth.create_access_token(
            data={"sub": str(test_admin.id), "username": test_admin.username}
        )
        return token
    finally:
        session.close()


# ──────────────────────────────────────────────────────────────────────────────
# Auth helper
# ──────────────────────────────────────────────────────────────────────────────

@pytest.fixture
def auth_headers(user_token) -> dict:
    """Headers with user token for API requests."""
    return {"Authorization": f"Bearer {user_token}"}


@pytest.fixture
def admin_headers(admin_token) -> dict:
    """Headers with admin token for API requests."""
    return {"Authorization": f"Bearer {admin_token}"}


# ──────────────────────────────────────────────────────────────────────────────
# Room fixtures
# ──────────────────────────────────────────────────────────────────────────────

@pytest.fixture
def test_room(db_session, test_user) -> Room:
    """Create a test room."""
    room = Room(
        name="Test Room",
        description="Room for testing",
        creator_id=test_user.id,
        is_active=True,
        room_type="public",
        max_users=50,
    )
    db_session.add(room)
    db_session.commit()
    db_session.refresh(room)
    return room


@pytest.fixture
def test_private_room(db_session, test_user) -> Room:
    """Create a private test room with password."""
    auth = AuthService(db_session)
    room = Room(
        name="Private Room",
        description="Private room for testing",
        creator_id=test_user.id,
        is_active=True,
        room_type="private",
        password_hash=auth.get_password_hash("roompass"),
        max_users=10,
    )
    db_session.add(room)
    db_session.commit()
    db_session.refresh(room)
    return room


# ──────────────────────────────────────────────────────────────────────────────
# Track fixtures
# ──────────────────────────────────────────────────────────────────────────────

@pytest.fixture
def test_track(db_session) -> Track:
    """Create a test track."""
    track = Track(
        source="soundcloud",
        source_track_id="sc_test_123",
        source_page_url="https://soundcloud.com/test/track",
        title="Test Track",
        artist="Test Artist",
        duration=180.0,
        stream_url="https://example.com/stream.mp3",
        stream_url_expires_at=datetime.utcnow() + timedelta(hours=1),
        processing_status="ready",
        processing_progress=100,
    )
    db_session.add(track)
    db_session.commit()
    db_session.refresh(track)
    return track


@pytest.fixture
def test_room_track(db_session, test_room, test_track) -> RoomTrack:
    """Create a test room track."""
    room_track = RoomTrack(
        room_id=test_room.id,
        source=test_track.source,
        source_track_id=test_track.source_track_id,
        title=test_track.title,
        artist=test_track.artist,
        duration=test_track.duration,
        stream_url="",
        order=1,
        added_by_id=test_room.creator_id,
        queue_state="ready",
    )
    db_session.add(room_track)
    db_session.commit()
    db_session.refresh(room_track)
    return room_track
