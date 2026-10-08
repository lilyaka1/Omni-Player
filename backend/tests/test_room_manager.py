"""
Unit tests for RoomManager and RoomState.

The current RoomManager API stores active room broadcasts in memory and exposes
get_or_create/is_live plus async start/stop methods.
"""

import asyncio

import pytest

from app.room.manager import RoomManager
from app.room.room_state import RoomState


class TestRoomManager:
    def test_create_room_manager(self):
        manager = RoomManager()

        assert manager.broadcasts == {}
        assert manager._last_activity == {}

    def test_get_or_create_room(self):
        manager = RoomManager()

        state = manager.get_or_create(1)

        assert isinstance(state, RoomState)
        assert state.room_id == 1
        assert manager.broadcasts[1] is state

    def test_get_existing_room_returns_same_state(self):
        manager = RoomManager()

        state1 = manager.get_or_create(42)
        state2 = manager.get_or_create(42)

        assert state1 is state2

    def test_is_live_false_for_missing_or_stopped_room(self):
        manager = RoomManager()

        assert manager.is_live(1) is False

        state = manager.get_or_create(1)
        state.running = False
        assert manager.is_live(1) is False

    def test_is_live_true_for_running_room(self):
        manager = RoomManager()
        state = manager.get_or_create(1)

        state.running = True

        assert manager.is_live(1) is True

    def test_stop_room_cleans_registered_room(self):
        manager = RoomManager()
        state = manager.get_or_create(99)
        state.running = True

        asyncio.run(manager.stop_room(99))

        assert 99 not in manager.broadcasts
        assert 99 not in manager._last_activity

    def test_room_state_add_and_remove_listener(self):
        state = RoomState(room_id=1)

        listener = state.add_listener()
        assert listener in state.listeners
        assert len(state.listeners) == 1

        state.remove_listener(listener)
        assert state.listeners == []

    def test_room_state_listener_limit(self):
        state = RoomState(room_id=1)
        state.MAX_LISTENERS = 1
        state.add_listener()

        with pytest.raises(RuntimeError):
            state.add_listener()

    def test_skip_event_is_created_lazily_and_reused(self):
        state = RoomState(room_id=1)

        first = state.skip_event
        second = state.skip_event

        assert isinstance(first, asyncio.Event)
        assert first is second
