"""
Unit tests for QueueService.

QueueService is the transaction-safe queue API. It returns QueueResult envelopes
instead of exposing ORM objects directly.
"""

from app.playback.queue_service import QueueService


def _track_data(source_track_id="sc123", title="Test Track"):
    return {
        "source": "soundcloud",
        "source_track_id": source_track_id,
        "title": title,
        "artist": "Artist",
        "duration": 180.0,
        "thumbnail": "",
        "genre": "test",
    }


class TestQueueService:
    def test_get_queue_for_empty_room(self, test_room):
        result = QueueService().get_queue(test_room.id)

        assert result.ok is True
        assert result.queue == []
        assert result.version == 0

    def test_get_queue_for_missing_room(self):
        result = QueueService().get_queue(99999)

        assert result.ok is False
        assert result.queue == []
        assert result.error == "room_not_found"

    def test_add_track_appends_to_queue_and_increments_version(self, test_room):
        service = QueueService()

        result = service.add_track(
            room_id=test_room.id,
            user_id=test_room.creator_id,
            track_data=_track_data(),
        )

        assert result.ok is True
        assert result.version == 1
        assert len(result.queue) == 1
        assert result.queue[0]["title"] == "Test Track"
        assert result.queue[0]["source_track_id"] == "sc123"

    def test_add_duplicate_track_is_deduplicated_by_default(self, test_room):
        service = QueueService()
        first = service.add_track(test_room.id, test_room.creator_id, _track_data("dup"))
        duplicate = service.add_track(test_room.id, test_room.creator_id, _track_data("dup"))

        assert first.ok is True
        assert duplicate.ok is True
        assert len(duplicate.queue) == 1
        assert duplicate.version == first.version

    def test_add_duplicate_track_can_be_allowed(self, test_room):
        service = QueueService()
        first = service.add_track(test_room.id, test_room.creator_id, _track_data("dup-ok"))
        second = service.add_track(
            test_room.id,
            test_room.creator_id,
            _track_data("dup-ok"),
            allow_duplicates=True,
        )

        assert first.ok is True
        assert second.ok is True
        assert len(second.queue) == 2
        assert second.version == first.version + 1

    def test_remove_track_deletes_item_and_increments_version(self, test_room):
        service = QueueService()
        added = service.add_track(test_room.id, test_room.creator_id, _track_data("remove"))
        queue_item_id = added.queue[0]["id"]

        removed = service.remove_track(test_room.id, queue_item_id, test_room.creator_id)

        assert removed.ok is True
        assert removed.queue == []
        assert removed.version == added.version + 1

    def test_remove_missing_track_returns_error_with_current_queue(self, test_room):
        service = QueueService()
        added = service.add_track(test_room.id, test_room.creator_id, _track_data("keep"))

        result = service.remove_track(test_room.id, 99999, test_room.creator_id)

        assert result.ok is False
        assert result.error == "track_not_found"
        assert result.queue == added.queue
        assert result.version == added.version

    def test_move_track_reorders_queue(self, test_room):
        service = QueueService()
        first = service.add_track(test_room.id, test_room.creator_id, _track_data("one", "One"))
        service.add_track(test_room.id, test_room.creator_id, _track_data("two", "Two"))

        moved = service.move_track(
            room_id=test_room.id,
            queue_item_id=first.queue[0]["id"],
            to_order=1,
            user_id=test_room.creator_id,
        )

        assert moved.ok is True
        assert [item["title"] for item in moved.queue] == ["Two", "One"]

    def test_move_track_with_stale_version_reports_conflict(self, test_room):
        service = QueueService()
        added = service.add_track(test_room.id, test_room.creator_id, _track_data("stale"))

        result = service.move_track(
            room_id=test_room.id,
            queue_item_id=added.queue[0]["id"],
            to_order=0,
            user_id=test_room.creator_id,
            expected_version=added.version - 1,
        )

        assert result.ok is False
        assert result.error == "stale_version"
        assert result.conflict is True

    def test_reorder_queue_keeps_requested_order(self, test_room):
        service = QueueService()
        first = service.add_track(test_room.id, test_room.creator_id, _track_data("one", "One"))
        second = service.add_track(test_room.id, test_room.creator_id, _track_data("two", "Two"))
        first_id = first.queue[0]["id"]
        second_id = second.queue[1]["id"]

        result = service.reorder_queue(
            room_id=test_room.id,
            new_order=[second_id, first_id],
            user_id=test_room.creator_id,
        )

        assert result.ok is True
        assert [item["id"] for item in result.queue] == [second_id, first_id]

    def test_clear_queue_removes_non_playing_items(self, test_room):
        service = QueueService()
        service.add_track(test_room.id, test_room.creator_id, _track_data("clear"))

        result = service.clear_queue(test_room.id, test_room.creator_id)

        assert result.ok is True
        assert result.queue == []

    def test_get_next_track_returns_none_without_current_track(self, test_room):
        service = QueueService()
        service.add_track(test_room.id, test_room.creator_id, _track_data("next"))

        assert service.get_next_track(test_room.id) is None

    def test_peek_queue_respects_limit(self, test_room):
        service = QueueService()
        for index in range(3):
            service.add_track(
                test_room.id,
                test_room.creator_id,
                _track_data(f"peek-{index}", f"Track {index}"),
            )

        result = service.peek_queue(test_room.id, limit=2)

        assert len(result) == 2
        assert [item["title"] for item in result] == ["Track 0", "Track 1"]
