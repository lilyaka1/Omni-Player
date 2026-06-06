"""
Unit tests for RoomService.

Tests room CRUD, join/leave, user management.
"""
import pytest
from app.domains.rooms.service import RoomService
from app.database.models import Room, User, RoomTrack


class TestRoomService:
    """Test cases for RoomService."""

    def test_create_room(self, db_session, test_user):
        """T-16: Create a new room successfully."""
        service = RoomService(db_session)
        room = service.create_room(
            name="My Room",
            owner=test_user,
            description="Test description",
            room_type="public",
            max_users=30,
        )

        assert room.id is not None
        assert room.name == "My Room"
        assert room.creator_id == test_user.id
        assert room.is_active is True
        assert room.max_users == 30

    def test_get_room(self, db_session, test_user):
        """T-17: Get room by ID."""
        service = RoomService(db_session)
        room = service.create_room(name="Get Room", owner=test_user)

        found = service.get_room(room.id)
        assert found is not None
        assert found.id == room.id
        assert found.name == "Get Room"

    def test_get_room_nonexistent(self, db_session):
        """T-18: Get non-existent room returns None."""
        service = RoomService(db_session)
        assert service.get_room(99999) is None

    def test_get_rooms(self, db_session, test_user):
        """T-19: Get list of rooms."""
        service = RoomService(db_session)
        service.create_room(name="Room 1", owner=test_user)
        service.create_room(name="Room 2", owner=test_user)
        service.create_room(name="Room 3", owner=test_user)

        rooms = service.get_rooms(limit=10)
        assert len(rooms) == 3

    def test_get_rooms_with_pagination(self, db_session, test_user):
        """T-20: Get rooms with pagination."""
        service = RoomService(db_session)
        for i in range(5):
            service.create_room(name=f"Room {i}", owner=test_user)

        # First page
        rooms = service.get_rooms(skip=0, limit=2)
        assert len(rooms) == 2

        # Second page
        rooms = service.get_rooms(skip=2, limit=2)
        assert len(rooms) == 2

    def test_update_room(self, db_session, test_user):
        """T-21: Update room details."""
        service = RoomService(db_session)
        room = service.create_room(name="Old Name", owner=test_user)

        updated = service.update_room(room.id, name="New Name", description="New desc")
        assert updated is not None
        assert updated.name == "New Name"
        assert updated.description == "New desc"

    def test_update_nonexistent_room(self, db_session):
        """T-22: Update non-existent room returns None."""
        service = RoomService(db_session)
        assert service.update_room(99999, name="New") is None

    def test_delete_room(self, db_session, test_user):
        """T-23: Delete room successfully."""
        service = RoomService(db_session)
        room = service.create_room(name="To Delete", owner=test_user)

        result = service.delete_room(room.id)
        assert result is True
        assert service.get_room(room.id) is None

    def test_delete_nonexistent_room(self, db_session):
        """T-24: Delete non-existent room returns False."""
        service = RoomService(db_session)
        assert service.delete_room(99999) is False

    def test_join_room(self, db_session, test_user):
        """T-25: User joins room successfully."""
        service = RoomService(db_session)
        room = service.create_room(name="Join Room", owner=test_user)

        # Create another user to join
        user2 = service.db.query(User).filter(User.username == "testuser").first()
        result = service.join_room(room.id, user2)
        assert result is True

        users = service.get_room_users(room.id)
        assert len(users) >= 1

    def test_join_nonexistent_room(self, db_session, test_user):
        """T-26: Join non-existent room returns False."""
        service = RoomService(db_session)
        assert service.join_room(99999, test_user) is False

    def test_join_inactive_room(self, db_session, test_user):
        """T-27: Join inactive room returns False."""
        service = RoomService(db_session)
        room = service.create_room(name="Inactive Room", owner=test_user)
        service.update_room(room.id, is_active=False)

        assert service.join_room(room.id, test_user) is False

    def test_leave_room(self, db_session, test_user):
        """T-28: User leaves room successfully."""
        service = RoomService(db_session)
        room = service.create_room(name="Leave Room", owner=test_user)

        # User joins first
        service.join_room(room.id, test_user)

        # Then leaves
        result = service.leave_room(room.id, test_user)
        assert result is True

    def test_leave_nonexistent_room(self, db_session, test_user):
        """T-29: Leave non-existent room returns False."""
        service = RoomService(db_session)
        assert service.leave_room(99999, test_user) is False

    def test_get_room_users(self, db_session, test_user):
        """T-30: Get users in room."""
        service = RoomService(db_session)
        room = service.create_room(name="Users Room", owner=test_user)
        service.join_room(room.id, test_user)

        users = service.get_room_users(room.id)
        assert len(users) >= 1
        assert any(u.id == test_user.id for u in users)

    def test_get_user_rooms(self, db_session, test_user):
        """T-31: Get rooms user is in."""
        service = RoomService(db_session)
        room1 = service.create_room(name="User Room 1", owner=test_user)
        room2 = service.create_room(name="User Room 2", owner=test_user)

        service.join_room(room1.id, test_user)
        service.join_room(room2.id, test_user)

        rooms = service.get_user_rooms(test_user.id)
        assert len(rooms) >= 2

    def test_room_with_max_users(self, db_session, test_user):
        """T-32: Room respects max_users setting."""
        service = RoomService(db_session)
        room = service.create_room(name="Small Room", owner=test_user, max_users=2)

        assert room.max_users == 2

    def test_room_default_values(self, db_session, test_user):
        """T-33: Room gets default values."""
        service = RoomService(db_session)
        room = service.create_room(name="Default Room", owner=test_user)

        assert room.is_active is True
        assert room.max_users == 50
        assert room.room_type == "public"
