"""
Integration-style tests for playback state transitions.
"""

from datetime import datetime, timedelta

from app.database.models import PlaybackSession, RoomTrack
from app.playback import controller


def _room(db_session, room_id):
    from app.database.models import Room

    db_session.expire_all()
    return db_session.query(Room).filter(Room.id == room_id).first()


def _add_room_track(db_session, room, source_track_id, title, order, duration=120.0):
    track = RoomTrack(
        room_id=room.id,
        source="soundcloud",
        source_track_id=source_track_id,
        title=title,
        artist="Artist",
        duration=duration,
        stream_url="",
        order=order,
        added_by_id=room.creator_id,
        queue_state="ready",
    )
    db_session.add(track)
    db_session.commit()
    db_session.refresh(track)
    return track


class TestPlaybackLogic:
    def test_playback_tick_starts_first_ready_track(self, db_session, test_room, test_room_track):
        controller.playback_tick(test_room.id)

        room = _room(db_session, test_room.id)
        session = db_session.query(PlaybackSession).filter_by(room_id=test_room.id).first()

        assert room.now_playing_track_id == test_room_track.id
        assert room.is_playing is True
        assert session is not None
        assert session.playback_state == "playing"
        assert session.current_queue_item_id == test_room_track.id

    def test_playback_tick_does_nothing_for_empty_queue(self, db_session, test_room):
        controller.playback_tick(test_room.id)

        room = _room(db_session, test_room.id)
        assert room.now_playing_track_id is None
        assert db_session.query(PlaybackSession).filter_by(room_id=test_room.id).first() is None

    def test_get_now_playing_prefers_playback_session(
        self, db_session, test_room, test_room_track
    ):
        session = PlaybackSession(
            room_id=test_room.id,
            current_queue_item_id=test_room_track.id,
            playback_state="playing",
            generation=1,
        )
        db_session.add(session)
        db_session.commit()

        now_playing = controller.get_now_playing(test_room.id)

        assert now_playing is not None
        assert now_playing.id == test_room_track.id

    def test_get_now_playing_falls_back_to_room_state(
        self, db_session, test_room, test_room_track
    ):
        test_room.now_playing_track_id = test_room_track.id
        db_session.commit()

        now_playing = controller.get_now_playing(test_room.id)

        assert now_playing is not None
        assert now_playing.id == test_room_track.id

    def test_update_playback_session_creates_session(self, db_session, test_room, test_room_track):
        session = controller.update_playback_session(
            room_id=test_room.id,
            new_state="playing",
            current_queue_item_id=test_room_track.id,
        )

        assert session is not None
        assert session.playback_state == "playing"
        assert session.current_queue_item_id == test_room_track.id

    def test_update_playback_session_rejects_invalid_transition(
        self, db_session, test_room, test_room_track
    ):
        controller.update_playback_session(
            room_id=test_room.id,
            new_state="playing",
            current_queue_item_id=test_room_track.id,
        )

        session = controller.update_playback_session(test_room.id, "idle")

        assert session is not None
        assert session.playback_state == "playing"

    def test_stalled_session_moves_to_recovering_on_tick(
        self, db_session, test_room, test_room_track
    ):
        session = PlaybackSession(
            room_id=test_room.id,
            current_queue_item_id=test_room_track.id,
            playback_state="stalled",
            generation=1,
            retry_count=0,
        )
        db_session.add(session)
        db_session.commit()

        controller.playback_tick(test_room.id)

        db_session.expire_all()
        updated = db_session.query(PlaybackSession).filter_by(room_id=test_room.id).first()
        assert updated.playback_state == "recovering"
        assert updated.retry_count == 1

    def test_expired_session_advances_to_next_track(self, db_session, test_room, test_room_track):
        second = _add_room_track(db_session, test_room, "next-track", "Next Track", 2)
        session = PlaybackSession(
            room_id=test_room.id,
            current_queue_item_id=test_room_track.id,
            playback_state="playing",
            expected_end_at=datetime.utcnow() - timedelta(seconds=1),
            generation=1,
        )
        test_room.now_playing_track_id = test_room_track.id
        db_session.add(session)
        db_session.commit()

        controller.playback_tick(test_room.id)

        room = _room(db_session, test_room.id)
        db_session.expire_all()
        updated = db_session.query(PlaybackSession).filter_by(room_id=test_room.id).first()
        assert room.now_playing_track_id == second.id
        assert updated.current_queue_item_id == second.id
        assert updated.playback_state == "playing"

    def test_ensure_playback_consistency_keeps_valid_track(
        self, db_session, test_room, test_room_track
    ):
        test_room.now_playing_track_id = test_room_track.id
        db_session.commit()

        assert controller.ensure_playback_consistency(test_room.id) == test_room_track.id

    def test_get_queue_and_empty_status(self, db_session, test_room, test_room_track):
        queue = controller.get_queue(test_room.id)

        assert [item.id for item in queue] == [test_room_track.id]
        assert controller.is_queue_empty(test_room.id) is False

    def test_hooks_receive_playback_events(self):
        events = []

        def hook(room_id, payload):
            events.append((room_id, payload["event"]))

        controller.register_hook(hook)
        try:
            controller.on_playback_event(123, "custom", {"ok": True})
        finally:
            controller.unregister_hook(hook)

        assert events == [(123, "custom")]
