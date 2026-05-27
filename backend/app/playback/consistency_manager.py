"""
System Consistency Contract Layer.

Единый мозг системы — гарантирует согласованность между:
    QueueService ←→ PlaybackController ←→ Timeline ←→ RoomGateway

Каждое изменение состояния проходит через этот слой.
Никаких silent desync fixes в отдельных сервисах.

Контракт:
    QUEUE STATE → PLAYBACK STATE → TIMELINE STATE → REALTIME STATE
    Все производны друг из друга, source of truth = DB.

Автовосстановление при drift обнаружении.
"""

from __future__ import annotations

import threading
import time
from dataclasses import dataclass, field
from datetime import datetime, timezone
from typing import Dict, List, Optional, Tuple

from app.database.session import SessionLocal
from app.database.models import Room, RoomTrack
from app.playback.controller import get_playback_session, set_now_playing, update_playback_session

# Lazy imports для избежания circular references
_controller = None
_loop = None
_gateway = None


def _get_controller():
    global _controller
    if _controller is None:
        try:
            from app.playback.controller import playback_controller
            _controller = playback_controller
        except ImportError:
            pass
    return _controller


def _get_loop():
    global _loop
    if _loop is None:
        try:
            from app.playback.loop import playback_loop
            _loop = playback_loop
        except ImportError:
            pass
    return _loop


def _get_gateway():
    global _gateway
    if _gateway is None:
        try:
            from app.realtime.room_gateway import room_gateway
            _gateway = room_gateway
        except ImportError:
            pass
    return _gateway


# ──────────────────────────────────────────────────────────────────────────────
#  Report types
# ──────────────────────────────────────────────────────────────────────────────

@dataclass
class ConsistencyIssue:
    """Единичная проблема консистентности."""
    code: str          # timeline_drift | queue_desync | playback_stale | loop_desync
    description: str
    severity: str      # critical | warning | info
    detected_at: float
    details: Optional[dict] = None


@dataclass
class ConsistencyReport:
    """Результат проверки комнаты."""
    room_id: int
    valid: bool
    issues: List[ConsistencyIssue]
    checked_at: float

    def summary(self) -> str:
        if self.valid:
            return f"Room {self.room_id}: ✅ CONSISTENT"
        codes = [i.code for i in self.issues]
        return f"Room {self.room_id}: ❌ {len(self.issues)} issue(s) — {codes}"


@dataclass
class RepairResult:
    """Результат восстановления."""
    room_id: int
    success: bool
    issues_fixed: List[str]
    issues_remaining: List[str]
    actions_taken: List[str]
    repaired_at: float


@dataclass
class ValidationResult:
    """Валидация конкретного правила."""
    rule: str
    passed: bool
    details: Optional[dict] = None


# ──────────────────────────────────────────────────────────────────────────────
#  ConsistencyManager
# ──────────────────────────────────────────────────────────────────────────────

class ConsistencyManager:
    """
    System brain — единая точка контроля консистентности.

    Invariants:
    1. now_playing_track_id is NULL → queue.get_next_track() defines next state
    2. is_playing == True → playback_started_at exists
    3. now_playing_track_id NOT duplicated in queue (or marked as "active")
    4. loop reads from QueueService, never raw DB
    """

    DRIFT_THRESHOLD_SEC = 1.0        # позиция разошлась больше чем на 1 сек
    STALE_THRESHOLD_SEC = 30.0       # loop не двигался 30 сек = stale
    HEARTBEAT_INTERVAL = 10.0        # periodic full check

    def __init__(self):
        self._lock = threading.RLock()
        self._rooms: Dict[int, _RoomConsistencyState] = {}
        self._event_hooks: Dict[str, List[callable]] = {}  # event → callbacks

        # Periodic check task
        self._running = False
        self._task: Optional[threading.Thread] = None

    # ── Room state tracker ─────────────────────────────────────────────────────

    def _get_room_state(self, room_id: int) -> "_RoomConsistencyState":
        with self._lock:
            if room_id not in self._rooms:
                self._rooms[room_id] = _RoomConsistencyState(room_id)
            return self._rooms[room_id]

    def start(self):
        """Запустить periodic consistency checks."""
        if self._running:
            return
        self._running = True
        self._task = threading.Thread(target=self._periodic_check, daemon=True)
        self._task.start()

    def stop(self):
        self._running = False

    # ── Event hooks ────────────────────────────────────────────────────────────

    def on_event(self, room_id: int, event_type: str, data: Optional[dict] = None):
        """
        Called after any state-changing event.

        Triggers optional validation. Heavy checks are deferred to background.
        """
        state = self._get_room_state(room_id)
        state.last_event = time.time()
        state.last_event_type = event_type

        # Immediate lightweight checks
        if event_type in ("track_finished", "track_started"):
            self._quick_validate_on_event(room_id, event_type, data)
        elif event_type == "queue_update":
            self._check_queue_playback_sync(room_id)

    def register_hook(self, event_type: str, callback: callable):
        """Register callback for events (e.g., loop.on_recovery)."""
        if event_type not in self._event_hooks:
            self._event_hooks[event_type] = []
        self._event_hooks[event_type].append(callback)

    def _emit_hook(self, event_type: str, room_id: int, data: dict):
        for cb in self._event_hooks.get(event_type, []):
            try:
                cb(room_id, data)
            except Exception as e:
                print(f"consistency hook error: {e}")

    # ── Quick validations (on event) ────────────────────────────────────────

    def _quick_validate_on_event(self, room_id: int, event_type: str, data: Optional[dict]):
        """Lightweight check triggered immediately after event."""
        if event_type == "track_finished":
            # After track finishes — ensure next track is set or loop is stopped
            self._check_playback_completeness(room_id)
        elif event_type == "track_started":
            # After new track — ensure timeline is active
            self._check_timeline_consistency(room_id)

    def _check_playback_completeness(self, room_id: int):
        """Проверка: playback не завис без следующего трека."""
        db = SessionLocal()
        try:
            room = db.query(Room).filter(Room.id == room_id).first()
            if not room:
                return

            # Prefer PlaybackSession as canonical source
            sess = get_playback_session(room_id)
            current_id = sess.current_queue_item_id if sess else room.now_playing_track_id
            if (sess and sess.playback_state == 'playing' and not current_id) or (room.is_playing and not current_id):
                self._repair_playback_stale(room_id, "is_playing=True but no track")
        finally:
            db.close()

    def _check_timeline_consistency(self, room_id: int):
        """Проверка: timeline согласован с playback."""
        try:
            from app.playback.timeline import timeline_manager
            state = timeline_manager.get_current_state(room_id)
            if not state:
                return

            db = SessionLocal()
            try:
                room = db.query(Room).filter(Room.id == room_id).first()
                if not room:
                    return

                # Prefer PlaybackSession as canonical source
                sess = get_playback_session(room_id)
                sess_playing = sess.playback_state == 'playing' if sess else room.is_playing
                if sess_playing and not state.is_playing:
                    self._repair_timeline_drift(room_id, "playback playing but timeline paused")
                elif state.is_playing and not sess_playing:
                    self._repair_timeline_drift(room_id, "timeline playing but playback paused")
            finally:
                db.close()
        except Exception:
            pass

    def _check_queue_playback_sync(self, room_id: int):
        """Проверка: now_playing не дублируется в очереди."""
        db = SessionLocal()
        try:
            # Use PlaybackSession as canonical source id if present
            sess = get_playback_session(room_id)
            current_id = None
            if sess and sess.current_queue_item_id:
                current_id = sess.current_queue_item_id
            else:
                room = db.query(Room).filter(Room.id == room_id).first()
                if not room or not room.now_playing_track_id:
                    return
                current_id = room.now_playing_track_id

            # Count occurrences in queue
            count = db.query(RoomTrack).filter(
                RoomTrack.room_id == room_id,
                RoomTrack.id == current_id,
            ).count()

            if count > 1:
                self._repair_queue_duplicate(room_id, current_id, count)
        finally:
            db.close()

    # ── Full consistency checks (background / on-demand) ─────────────────────

    def validate_room_state(self, room_id: int) -> ConsistencyReport:
        """
        Полная проверка консистентности комнаты.

        Проверяет все 4 rules + drift detection.
        """
        issues: List[ConsistencyIssue] = []
        now = time.time()

        db = SessionLocal()
        try:
            room = db.query(Room).filter(Room.id == room_id).first()
            if not room:
                return ConsistencyReport(
                    room_id=room_id, valid=False,
                    issues=[ConsistencyIssue(
                        code="room_missing",
                        description="Room does not exist",
                        severity="critical",
                        detected_at=now,
                    )],
                    checked_at=now,
                )

            # Rule 1: Playback invariants
            if not room.now_playing_track_id and room.is_playing:
                issues.append(ConsistencyIssue(
                    code="playback_stale",
                    description="is_playing=True but now_playing_track_id is NULL",
                    severity="critical",
                    detected_at=now,
                ))

            # Rule 2: Timeline invariants
            if room.is_playing and not room.playback_started_at:
                issues.append(ConsistencyIssue(
                    code="timeline_stale",
                    description="is_playing=True but playback_started_at is NULL",
                    severity="critical",
                    detected_at=now,
                ))

            # Rule 3: Queue invariants — check no duplicate now_playing
            if room.now_playing_track_id:
                count = db.query(RoomTrack).filter(
                    RoomTrack.room_id == room_id,
                    RoomTrack.id == room.now_playing_track_id,
                ).count()
                if count > 1:
                    issues.append(ConsistencyIssue(
                        code="queue_duplicate",
                        description=f"now_playing_track_id appears {count} times in queue",
                        severity="warning",
                        detected_at=now,
                        details={"duplicate_count": count},
                    ))

            # Rule 4: Loop — check loop not stale (is_playing but no progress)
            try:
                from app.playback.timeline import timeline_manager
                tl_state = timeline_manager.get_current_state(room_id)
                if tl_state and tl_state.is_playing and room.is_playing:
                    position = tl_state.get_position(now)
                    state = self._get_room_state(room_id)
                    if state.last_known_position is not None:
                        time_delta = now - state.last_position_check
                        position_delta = position - state.last_known_position
                        if time_delta > 5.0 and position_delta < 0.1:
                            issues.append(ConsistencyIssue(
                                code="loop_stall",
                                description="Timeline not progressing for >5s",
                                severity="warning",
                                detected_at=now,
                                details={"position": position, "time_delta": time_delta},
                            ))
                    state.last_known_position = position
                    state.last_position_check = now
            except Exception:
                pass

            # Drift check
            try:
                from app.playback.timeline import timeline_manager
                tl_state = timeline_manager.get_current_state(room_id)
                if tl_state:
                    elapsed = tl_state.get_position(now)
                    if room.now_playing_track_id:
                        track = db.query(RoomTrack).filter(
                            RoomTrack.id == room.now_playing_track_id
                        ).first()
                        if track and track.duration and elapsed > track.duration + self.DRIFT_THRESHOLD_SEC:
                            issues.append(ConsistencyIssue(
                                code="timeline_drift",
                                description=f"Position {elapsed:.1f}s exceeds duration {track.duration}s",
                                severity="warning",
                                detected_at=now,
                                details={"position": elapsed, "duration": track.duration},
                            ))
            except Exception:
                pass

            valid = all(i.severity != "critical" for i in issues)
            return ConsistencyReport(
                room_id=room_id, valid=valid,
                issues=issues, checked_at=now,
            )

        finally:
            db.close()

    def ensure_room_consistency(self, room_id: int) -> ConsistencyReport:
        """
        Ensure consistency before snapshot/sync.

        Validates + auto-repairs minor issues.
        """
        report = self.validate_room_state(room_id)

        # Auto-repair non-critical issues
        for issue in report.issues:
            if issue.severity != "critical":
                self._auto_repair_issue(room_id, issue)

        # Re-validate after repairs
        if any(i.severity != "critical" for i in report.issues):
            report = self.validate_room_state(room_id)

        return report

    def repair_room_state(self, room_id: int) -> RepairResult:
        """
        Hard repair комнаты — вызывается при обнаружении critical issues.
        """
        actions: List[str] = []
        fixed: List[str] = []
        remaining: List[str] = []

        db = SessionLocal()
        try:
            room = db.query(Room).filter(Room.id == room_id).first()
            if not room:
                return RepairResult(
                    room_id=room_id, success=False,
                    issues_fixed=[], issues_remaining=["room_missing"],
                    actions_taken=[], repaired_at=time.time(),
                )

            # 1. Stop loop (soft pause)
            loop = _get_loop()
            if loop:
                loop.pause_room(room_id)
                actions.append("loop_paused")

            # 2. Rebuild playback from QueueService using controller (authority)
            try:
                from app.playback.queue_service import queue_service
                next_track = queue_service.get_next_track(room_id)
                if next_track:
                    # Use controller to set now playing
                    try:
                        set_now_playing(room_id, next_track["id"])
                        actions.append(f"playback_rebuilt_next_track_{next_track['id']}")
                    except Exception:
                        remaining.append("playback_rebuild_set_now_playing_failed")
                else:
                    # Clear playback via PlaybackSession
                    try:
                        update_playback_session(room_id, 'stopped')
                        actions.append("playback_cleared_no_next_track")
                    except Exception:
                        remaining.append("playback_clear_failed")
                fixed.append("playback_state")
            except Exception as e:
                remaining.append(f"playback_rebuild_failed: {e}")

            # 3. Restart timeline (stop, don't start — let clients sync first)
            try:
                from app.playback.timeline import timeline_manager
                timeline_manager.stop(room_id)
                actions.append("timeline_stopped")
                fixed.append("timeline")
            except Exception as e:
                remaining.append(f"timeline_reset_failed: {e}")

            # 4. Broadcast full snapshot via gateway
            gateway = _get_gateway()
            if gateway:
                try:
                    from app.realtime.room_gateway import room_gateway
                    # We don't have websocket here — just mark for next broadcast
                    actions.append("snapshot_queued_for_broadcast")
                except Exception:
                    pass

            db.commit()
            success = len(remaining) == 0

            return RepairResult(
                room_id=room_id, success=success,
                issues_fixed=fixed, issues_remaining=remaining,
                actions_taken=actions, repaired_at=time.time(),
            )

        finally:
            db.close()

    def full_rebuild(self, room_id: int) -> RepairResult:
        """
        Hard recovery — source of truth = DB only.

        Используется при полном рассинхроне после crash.
        """
        # Stop everything
        try:
            from app.playback.loop import playback_loop
            playback_loop.stop_room(room_id)
        except Exception:
            pass

        try:
            from app.playback.timeline import timeline_manager
            timeline_manager.stop(room_id)
        except Exception:
            pass

        # Validate DB state only
        db = SessionLocal()
        try:
            room = db.query(Room).filter(Room.id == room_id).first()
            if room and room.now_playing_track_id:
                track = db.query(RoomTrack).filter(
                    RoomTrack.id == room.now_playing_track_id
                ).first()
                if track:
                    # Restore timeline from DB
                    from app.playback.timeline import timeline_manager
                    started_at = room.playback_started_at.timestamp() if room.playback_started_at else time.time()
                    timeline_manager.start_track(room_id, track.id)
                    if not room.is_playing:
                        timeline_manager.pause(room_id)
        finally:
            db.close()

        result = self.repair_room_state(room_id)
        result.actions_taken.append("full_rebuild_completed")
        return result

    # ── Internal repair helpers ────────────────────────────────────────────────

    def _auto_repair_issue(self, room_id: int, issue: ConsistencyIssue):
        """Auto-repair non-critical issues."""
        if issue.code == "queue_duplicate":
            count = (issue.details or {}).get("duplicate_count", 2)
            track_id = self._get_current_track_id(room_id)
            if track_id:
                self._repair_queue_duplicate(room_id, track_id, count)

    def _repair_queue_duplicate(self, room_id: int, track_id: int, count: int):
        """Удалить дубликаты now_playing из queue, оставив только 1."""
        db = SessionLocal()
        try:
            # Оставляем самый первый (с минимальным id), удаляем остальные
            tracks = (
                db.query(RoomTrack)
                .filter(
                    RoomTrack.room_id == room_id,
                    RoomTrack.id == track_id,
                )
                .order_by(RoomTrack.id)
                .all()
            )
            if len(tracks) > 1:
                for t in tracks[1:]:  # удаляем все кроме первого
                    db.delete(t)
                db.commit()
                print(f"🧹 Room {room_id}: removed {len(tracks)-1} duplicate now_playing from queue")
        finally:
            db.close()

    def _repair_playback_stale(self, room_id: int, reason: str):
        """Восстановить playback state если он завис."""
        db = SessionLocal()
        try:
            # Tell PlaybackSession to stop — controller is authority
            try:
                update_playback_session(room_id, 'stopped')
                print(f"🧯 Room {room_id}: repaired playback_stale via PlaybackSession — {reason}")
            except Exception:
                # Controller unavailable — do not mutate playback state here
                print(f"⚠️ [consistency] update_playback_session failed for room {room_id}; controller unavailable")
        finally:
            db.close()

    def _repair_timeline_drift(self, room_id: int, reason: str):
        """Восстановить timeline sync с playback state."""
        db = SessionLocal()
        try:
            # Use PlaybackSession as canonical source
            sess = get_playback_session(room_id)
            if not sess or not sess.current_queue_item_id:
                return
            from app.playback.timeline import timeline_manager
            if sess.playback_state == 'playing':
                timeline_manager.resume(room_id)
            else:
                timeline_manager.pause(room_id)
            print(f"🧯 Room {room_id}: timeline drift repaired — {reason}")
        finally:
            db.close()

    def _get_current_track_id(self, room_id: int) -> Optional[int]:
        sess = get_playback_session(room_id)
        if sess and sess.current_queue_item_id:
            return sess.current_queue_item_id
        db = SessionLocal()
        try:
            room = db.query(Room).filter(Room.id == room_id).first()
            return room.now_playing_track_id if room else None
        finally:
            db.close()

    # ── Periodic checks ────────────────────────────────────────────────────────

    def _periodic_check(self):
        """Background thread — проверяет все активные комнаты."""
        while self._running:
            time.sleep(self.HEARTBEAT_INTERVAL)
            if not self._running:
                break

            room_ids = list(self._rooms.keys())
            for room_id in room_ids:
                try:
                    report = self.validate_room_state(room_id)
                    if not report.valid:
                        # Log critical issues
                        for issue in report.issues:
                            if issue.severity == "critical":
                                print(f"⚠️ CRITICAL: {report.summary()} — {issue.description}")
                                # Auto-repair
                                self.repair_room_state(room_id)
                except Exception as e:
                    print(f"consistency check error room {room_id}: {e}")

    # ── Accessors ──────────────────────────────────────────────────────────────

    def get_report(self, room_id: int) -> Optional[ConsistencyReport]:
        """Быстрая проверка без автовосстановления."""
        state = self._get_room_state(room_id)
        if time.time() - state.last_check < 5.0:
            return state.cached_report
        report = self.validate_room_state(room_id)
        state.cached_report = report
        return report


class _RoomConsistencyState:
    """Per-room tracking для consistency manager."""

    def __init__(self, room_id: int):
        self.room_id = room_id
        self.last_event = time.time()
        self.last_event_type: Optional[str] = None
        self.last_check = 0.0
        self.cached_report: Optional[ConsistencyReport] = None
        self.last_known_position: Optional[float] = None
        self.last_position_check: float = 0.0


# ──────────────────────────────────────────────────────────────────────────────
#  Global instance
# ──────────────────────────────────────────────────────────────────────────────

consistency_manager = ConsistencyManager()