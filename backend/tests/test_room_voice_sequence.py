import asyncio

from app.voice_inserts.tts import TTSResult


def test_build_room_voice_sequence_calls_tts_once(monkeypatch, tmp_path):
    from app.voice_inserts import queue as voice_queue

    voice_queue._room_voice_sequence_cache.clear()

    generated_texts = []
    audio_file = tmp_path / "voice-test.mp3"
    audio_file.write_bytes(b"fake mp3 data")

    snapshot = {
        "room": {
            "id": 1,
            "name": "Test Room",
            "description": "Room voice sequence test",
            "queue_mode": "normal",
        },
        "tracks": [
            {"id": 11, "title": "First", "artist": "Artist A", "order": 1},
            {"id": 12, "title": "Second", "artist": "Artist B", "order": 2},
        ],
    }

    async def fake_generate_speech(text: str, voice_id: str = "en_US-libritts-high", use_rvc: bool = True, **kwargs):
        generated_texts.append(text)
        return TTSResult(success=True, audio_path=str(audio_file), duration_sec=1.25)

    def fake_upsert_media_asset(audio_path: str, canonical_key: str, fingerprint_meta: str):
        return 101

    monkeypatch.setattr(voice_queue, "_load_room_voice_snapshot", lambda room_id: snapshot)
    monkeypatch.setattr(voice_queue, "generate_speech", fake_generate_speech)
    monkeypatch.setattr(voice_queue, "_upsert_media_asset", fake_upsert_media_asset)

    first_inserts = asyncio.run(voice_queue.build_room_voice_sequence(1))
    second_inserts = asyncio.run(voice_queue.build_room_voice_sequence(1))

    assert len(first_inserts) == 1
    assert first_inserts == second_inserts
    assert len(generated_texts) == 1
    assert first_inserts[0]["play_after_track_id"] == 11
    assert first_inserts[0]["media_asset_id"] == 101


def test_start_room_twice_does_not_duplicate_inserts(monkeypatch):
    from app.room.manager import RoomManager

    manager = RoomManager()
    inserted = [{"id": 5, "audio_path": "/tmp/insert.mp3", "play_after_track_id": 11}]
    build_calls = []
    scheduled_tasks = []
    real_create_task = asyncio.create_task

    async def fake_build_room_voice_sequence(room_id: int):
        build_calls.append(room_id)
        return inserted

    async def fake_prewarm_room(room_id: int, admin_id=None):
        return 0

    async def fake_broadcast_loop(self, bc, room_id, db_session_factory, soundcloud_client):
        await asyncio.sleep(0)
        bc.running = True

    def fake_create_task(coro):
        task = real_create_task(coro)
        scheduled_tasks.append(task)
        return task

    monkeypatch.setattr("app.room.manager.build_room_voice_sequence", fake_build_room_voice_sequence)
    monkeypatch.setattr("app.room.manager.get_room_voice_sequence_signature", lambda room_id: "sig-77")
    monkeypatch.setattr("app.room.manager.RoomManager._broadcast_loop", fake_broadcast_loop)
    monkeypatch.setattr("app.voice_inserts.queue.prewarm_room", fake_prewarm_room)
    monkeypatch.setattr("app.room.manager.asyncio.create_task", fake_create_task)
    monkeypatch.setattr(manager, "prefetch_room_files", lambda *args, **kwargs: asyncio.sleep(0))

    async def run_test():
        start_task = asyncio.create_task(manager.start_room(77, lambda: None, None))
        await asyncio.sleep(0)
        await manager.start_room(77, lambda: None, None)
        await asyncio.gather(*scheduled_tasks)
        await start_task

    asyncio.run(run_test())

    state = manager.get_or_create(77)
    assert build_calls == [77]
    assert state.voice_insert_queue == inserted
    assert state.voice_insert_signature == "sig-77"


def test_runtime_playback_does_not_rebuild(monkeypatch):
    from app.room.manager import RoomManager
    from app.room.room_state import RoomState
    from app.voice_inserts import queue as voice_queue

    manager = RoomManager()
    state = RoomState(room_id=123)
    state.set_voice_insert_queue(
        [{"id": 1, "audio_path": "/tmp/insert.mp3", "play_after_track_id": 10}],
        signature="sig-123",
    )

    def fail_build(*args, **kwargs):
        raise AssertionError("builder must not run in runtime playback")

    async def fail_generate(*args, **kwargs):
        raise AssertionError("generate_speech must not run in runtime playback")

    async def fake_stream_ffmpeg(*args, **kwargs):
        return True

    async def fake_mark_insert_played(*args, **kwargs):
        return None

    async def fake_broadcast_insert_event(*args, **kwargs):
        return None

    monkeypatch.setattr(voice_queue, "build_room_voice_sequence", fail_build)
    monkeypatch.setattr(voice_queue, "generate_speech", fail_generate)
    monkeypatch.setattr("app.room.manager.stream_ffmpeg", fake_stream_ffmpeg)
    monkeypatch.setattr(voice_queue, "mark_insert_played", fake_mark_insert_played)
    monkeypatch.setattr(manager, "_broadcast_insert_event", fake_broadcast_insert_event)

    asyncio.run(manager._play_voice_inserts(state, 123, 10))
    assert state.voice_insert_queue == []