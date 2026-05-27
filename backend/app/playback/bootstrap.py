"""
Bootstrap layer — bridges WS join → playback start.

Проблема: playback loop НЕ стартует автоматически при join.
Причина: нет вызова start_room при подключении через WS.

Решение: при каждом WS join — вызвать join_room_and_start() который:
  1. Проверяет/инициализирует playback loop для комнаты
  2. Выбирает первый трек из очереди если now_playing_track_id=None
  3. Стартует timeline если есть now_playing_track_id
  4. Бросает событие в consistency_manager
"""

from dataclasses import dataclass, field
from datetime import datetime, timezone
from typing import List, Optional

from app.database.session import SessionLocal
from app.database.models import Room, RoomTrack


@dataclass
class BootstrapResult:
    ok: bool
    now_playing_track_id: Optional[int] = None
    actions: List[str] = field(default_factory=list)
    errors: List[str] = field(default_factory=list)

    def __str__(self):
        return f"BootstrapResult(ok={self.ok}, now_playing={self.now_playing_track_id}, actions={self.actions}, errors={self.errors})"


def join_room_and_start_sync(room_id: int, user_id: Optional[int] = None) -> BootstrapResult:
    """
    Синхронная версия — вызывается из asyncio.to_thread() в WS handler.

    Логика:
    1. Если now_playing_track_id уже установлен → sync PlaybackSession
    2. Если нет → вызывает start_playback (проверяет TrackAsset.status == 'ready')
    3. Если есть трек → стартуем timeline
    4. Уведомляем consistency_manager

    Возвращает BootstrapResult с actions + errors для логирования.
    """
    print(f"🚀 [bootstrap] start_room called room={room_id} user_id={user_id}")
    db = SessionLocal()
    try:
        room = db.query(Room).filter(Room.id == room_id).first()
        if not room:
            return BootstrapResult(ok=False, errors=[f"room {room_id} not found"])

        actions: List[str] = []
        errors: List[str] = []

        track_id: Optional[int] = room.now_playing_track_id

        # ── Case 1: playback already running — sync PlaybackSession ────────────
        if track_id:
            try:
                from app.playback.controller import update_playback_session
                update_playback_session(room_id, 'playing', current_queue_item_id=track_id)
            except Exception:
                pass
            actions.append("already_playing")
            print(f"🎵 [bootstrap] Room {room_id}: track selected/restored track_id={track_id}")
        else:
            # ── Case 2: no track selected — use start_playback ───────────────
            # start_playback enforces TrackAsset.status == 'ready' invariant
            try:
                from app.playback.controller import start_playback
                started_track_id = start_playback(room_id)
                if started_track_id:
                    track_id = started_track_id
                    actions.append(f"track_started:{track_id}")
                    print(f"🎵 [bootstrap] Room {room_id}: track started via start_playback track_id={track_id}")
                else:
                    print(f"ℹ️ [bootstrap] Room {room_id}: no ready tracks in queue")
                    actions.append("queue_empty")
                    return BootstrapResult(ok=True, now_playing_track_id=None, actions=actions)
            except Exception as e:
                print(f"⚠️ [bootstrap] start_playback failed for room {room_id}: {e}")
                return BootstrapResult(ok=False, now_playing_track_id=None, actions=actions, errors=[str(e)])

        # ── Case 3: start timeline ───────────────────────────────────────────────
        if track_id is not None:
            try:
                from app.playback.timeline import timeline_manager
                timeline_state = timeline_manager.sync_from_db(room_id)
                if timeline_state is None:
                    timeline_state = timeline_manager.start_track(room_id, track_id)
                if timeline_state is not None:
                    print(f"⏱️ [bootstrap] Room {room_id}: loop started for track {track_id}")
                actions.append("timeline_started")
            except Exception as e:
                errors.append(f"timeline start failed: {e}")
                print(f"⚠️ [bootstrap] Room {room_id}: timeline start failed: {e}")

        # ── Case 4: notify consistency manager ─────────────────────────────────
        if track_id is not None:
            try:
                from app.playback.consistency_manager import consistency_manager
                consistency_manager.on_event(room_id, "track_started", {"track_id": track_id})
                actions.append("consistency_notified")
            except Exception as e:
                print(f"⚠️ [bootstrap] consistency notification failed: {e}")

        return BootstrapResult(
            ok=True,
            now_playing_track_id=track_id,
            actions=actions,
            errors=errors,
        )

    except Exception as e:
        db.rollback()
        return BootstrapResult(ok=False, errors=[str(e)])
    finally:
        db.close()


async def join_room_and_start(room_id: int, user_id: Optional[int] = None) -> BootstrapResult:
    """Async wrapper — вызывается из WS handler."""
    import asyncio
    result = await asyncio.to_thread(join_room_and_start_sync, room_id, user_id)

    # Call register_room SYNCHRONOUSLY (not fire-and-forget)
    # Previous code used asyncio.create_task which schedules to next event-loop tick,
    # delaying loop start by 1+ tick. Direct synchronous call is instant.
    # register_room() itself schedules _start_loop as a task (that's fine — it stays async).
    if result.ok and result.now_playing_track_id is not None:
        try:
            from app.playback.loop import playback_loop
            ok = playback_loop.register_room(room_id)
            if ok:
                print(f"✅ [bootstrap] Room {room_id}: loop started (register_room returned true)")
            else:
                print(f"⚠️ [bootstrap] Room {room_id}: register returned False (queue empty?)")
        except Exception as e:
            print(f"❌ [bootstrap] register_room failed: {e}")
            import traceback; traceback.print_exc()

    return result


# ── CLI debug helper (for manual testing) ──────────────────────────────────

if __name__ == "__main__":
    import sys
    if len(sys.argv) < 2:
        print("Usage: python bootstrap.py <room_id>")
        sys.exit(1)

    room_id = int(sys.argv[1])
    result = join_room_and_start_sync(room_id)
    print(f"Result: {result}")
