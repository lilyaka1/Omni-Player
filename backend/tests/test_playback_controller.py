"""
Unit tests for playback controller functions.

The real playback controller is a functional module that mutates Room and
PlaybackSession state in the database.
"""

from app.database.models import PlaybackSession, Room
from app.playback import controller


def _refresh(db_session, obj):
    db_session.expire(obj)
    return db_session.query(type(obj)).filter(type(obj).id == obj.id).first()


class TestPlaybackController:
    def test_start_playback_empty_queue_returns_none(self, db_session, test_room):
        result = controller.start_playback(test_room.id)

        room = _refresh(db_session, test_room)
        assert result is None
        assert room.now_playing_track_id is None

    def test_start_playback_selects_first_ready_track(self, db_session, test_room, test_room_track):
        result = controller.start_playback(test_room.id)

        room = _refresh(db_session, test_room)
        session = db_session.query(PlaybackSession).filter_by(room_id=test_room.id).first()

        assert result == test_room_track.id
        assert room.now_playing_track_id == test_room_track.id
        assert room.is_playing is True
        assert session is not None
        assert session.playback_state == "playing"
        assert session.current_queue_item_id == test_room_track.id

    def test_start_playback_is_idempotent_when_track_is_already_playing(
        self, db_session, test_room, test_room_track
    ):
        first_result = controller.start_playback(test_room.id)
        second_result = controller.start_playback(test_room.id)

        room = _refresh(db_session, test_room)
        assert first_result == test_room_track.id
        assert second_result == test_room_track.id
        assert room.now_playing_track_id == test_room_track.id

    def test_stop_playback_clears_now_playing(self, db_session, test_room, test_room_track):
        controller.start_playback(test_room.id)

        result = controller.stop_playback(test_room.id)

        room = _refresh(db_session, test_room)
        assert result is True
        assert room.now_playing_track_id is None

    def test_stop_playback_missing_room_returns_false(self):
        assert controller.stop_playback(99999) is False

    def test_set_now_playing_rejects_track_from_another_room(
        self, db_session, test_room, test_room_track
    ):
        other_room = Room(
            name="Other Room",
            creator_id=test_room.creator_id,
            is_active=True,
            room_type="public",
        )
        db_session.add(other_room)
        db_session.commit()
        db_session.refresh(other_room)

        result = controller.set_now_playing(other_room.id, test_room_track.id)

        other_room = _refresh(db_session, other_room)
        assert result is False
        assert other_room.now_playing_track_id is None

    def test_set_now_playing_accepts_track_in_same_room(
        self, db_session, test_room, test_room_track
    ):
        result = controller.set_now_playing(test_room.id, test_room_track.id)

        room = _refresh(db_session, test_room)
        assert result is True
        assert room.now_playing_track_id == test_room_track.id
        assert room.is_playing is True

    def test_next_track_advances_by_queue_order(self, db_session, test_room, test_room_track):
        second = test_room_track.__class__(
            room_id=test_room.id,
            source="soundcloud",
            source_track_id="sc_second",
            title="Second Track",
            artist="Test Artist",
            duration=120.0,
            stream_url="",
            order=2,
            added_by_id=test_room.creator_id,
            queue_state="ready",
        )
        db_session.add(second)
        db_session.commit()
        db_session.refresh(second)

        assert controller.start_playback(test_room.id) == test_room_track.id
        assert controller.next_track(test_room.id) == second.id

        room = _refresh(db_session, test_room)
        assert room.now_playing_track_id == second.id

    def test_get_queue_and_empty_helpers(self, db_session, test_room, test_room_track):
        queue = controller.get_queue(test_room.id)

        assert [item.id for item in queue] == [test_room_track.id]
        assert controller.is_queue_empty(test_room.id) is False

    def test_get_playback_session_missing_room_returns_none(self):
        assert controller.get_playback_session(99999) is None
