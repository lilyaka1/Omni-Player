"""
Server-Authoritative Playback Timeline System.

Единственный источник истины по playback position в комнате.

Архитектура:
    PlaybackLoop → timeline.next_track()
    RoomGateway → emits track_sync (position + server_time)
    Frontend → синхронизирует audio.currentTime по server state

Формула позиции:
    if is_playing:  position = now() - started_at + accumulated_offset
    else:           position = accumulated_offset
"""

from __future__ import annotations

import asyncio
import time
import threading
import math
from dataclasses import dataclass, field
from datetime import datetime, timezone
from typing import Dict, Optional, Tuple

from sqlalchemy.orm import Session

from app.database.session import SessionLocal
from app.database.models import Room, RoomTrack


# ──────────────────────────────────────────────────────────────────────────────
#  Data models
# ──────────────────────────────────────────────────────────────────────────────

@dataclass
class TrackTimelineState:
    """
    State одного трека в timeline.

    started_at: серверное время старта трека (utcnow timestamp)
    paused_at: None если играет, timestamp если на паузе
    accumulated_offset: секунды накопленные ДО текущего started_at
    is_playing: True = играет, False = на паузе
    track_id: id трека
    """
    track_id: int
    started_at: float  # time.time() snapshot при старте
    paused_at: Optional[float] = None
    accumulated_offset: float = 0.0
    is_playing: bool = True

    def get_position(self, now: Optional[float] = None) -> float:
        """Текущая позиция в секундах."""
        if now is None:
            now = time.time()

        if self.is_playing:
            return (now - self.started_at) + self.accumulated_offset
        else:
            return self.accumulated_offset

    def pause(self, now: Optional[float] = None) -> None:
        """Поставить на паузу, накопить время."""
        if now is None:
            now = time.time()
        if self.is_playing:
            self.accumulated_offset += (now - self.started_at)
            self.started_at = now
            self.is_playing = False
            self.paused_at = now

    def resume(self, now: Optional[float] = None) -> None:
        """Возобновить воспроизведение."""
        if now is None:
            now = time.time()
        if not self.is_playing:
            self.started_at = now
            self.is_playing = True
            self.paused_at = None

    def to_snapshot(self, now: Optional[float] = None) -> dict:
        """Сериализуемый snapshot для клиента."""
        if now is None:
            now = time.time()
        return {
            "track_id": self.track_id,
            "position": round(self.get_position(now), 3),
            "is_playing": self.is_playing,
            "server_time": datetime.fromtimestamp(now, tz=timezone.utc).isoformat(),
            "paused_at": datetime.fromtimestamp(self.paused_at).isoformat() if self.paused_at else None,
        }


# ──────────────────────────────────────────────────────────────────────────────
#  RoomTimelineManager
# ──────────────────────────────────────────────────────────────────────────────

class RoomTimelineManager:
    """
    Менеджер timeline для всех комнат.

    Хранит in-memory state + опционально sync в DB.
    Это server-side state — не читается с клиента.
    """

    def __init__(self):
        # room_id → TrackTimelineState
        self._states: Dict[int, TrackTimelineState] = {}
        self._lock = threading.Lock()
        # room_id → asyncio.Lock (для async операций)
        self._async_locks: Dict[int, asyncio.Lock] = {}

    # ── Per-room lock ──────────────────────────────────────────────────────────

    def _get_async_lock(self, room_id: int) -> asyncio.Lock:
        if room_id not in self._async_locks:
            self._async_locks[room_id] = asyncio.Lock()
        return self._async_locks[room_id]

    # ── Core operations ───────────────────────────────────────────────────────

    def start_track(self, room_id: int, track_id: int) -> TrackTimelineState:
        """
        Начать новый трек.

        При вызове сбрасывает состояние предыдущего трека.
        """
        state = TrackTimelineState(
            track_id=track_id,
            started_at=time.time(),
            accumulated_offset=0.0,
            is_playing=True,
            paused_at=None,
        )
        with self._lock:
            self._states[room_id] = state
        return state

    def pause(self, room_id: int) -> Optional[TrackTimelineState]:
        """Поставить текущий трек на паузу."""
        with self._lock:
            state = self._states.get(room_id)
            if state:
                state.pause()
            return state

    def resume(self, room_id: int) -> Optional[TrackTimelineState]:
        """Возобновить воспроизведение."""
        with self._lock:
            state = self._states.get(room_id)
            if state:
                state.resume()
            return state

    def seek(self, room_id: int, position: float) -> Optional[TrackTimelineState]:
        """
        Переместить playback position.

        Если играет — сбрасываем started_at и пересчитываем accumulated_offset.
        """
        with self._lock:
            state = self._states.get(room_id)
            if not state:
                return None

            now = time.time()
            if state.is_playing:
                # текущее время трека на момент seek
                current = (now - state.started_at) + state.accumulated_offset
                delta = position - current
                state.accumulated_offset += delta
                # started_at не меняем — проще считать offset от него
                state.started_at = now
            else:
                # на паузе — просто ставим accumulated_offset
                state.accumulated_offset = position

            return state

    def get_current_state(self, room_id: int) -> Optional[TrackTimelineState]:
        """Получить текущее состояние timeline комнаты."""
        with self._lock:
            return self._states.get(room_id)

    def get_position(self, room_id: int) -> Optional[float]:
        """Получить текущую позицию в секундах."""
        with self._lock:
            state = self._states.get(room_id)
            return state.get_position() if state else None

    def get_sync_payload(self, room_id: int) -> Optional[dict]:
        """
        Получить полезную нагрузку для track_sync события.

        Возвращает None если комната неактивна.
        """
        with self._lock:
            state = self._states.get(room_id)
            if not state:
                return None

            now = time.time()
            return {
                "track_id": state.track_id,
                "position": round(state.get_position(now), 3),
                "is_playing": state.is_playing,
                "server_time": datetime.fromtimestamp(now, tz=timezone.utc).isoformat(),
            }

    def stop(self, room_id: int) -> Optional[TrackTimelineState]:
        """Остановить playback — сбросить state."""
        with self._lock:
            state = self._states.pop(room_id, None)
            return state

    def has_active_timeline(self, room_id: int) -> bool:
        """Есть ли активный timeline для комнаты."""
        with self._lock:
            return room_id in self._states

    # ── Sync helpers (DB persistence) ──────────────────────────────────────────

    def sync_from_db(self, room_id: int) -> Optional[TrackTimelineState]:
        """
        Восстановить timeline state из DB.

        Используется при старте приложения или reconnect.
        """
        db = SessionLocal()
        try:
            room = db.query(Room).filter(Room.id == room_id).first()
            if not room or not room.now_playing_track_id:
                return None

            track = db.query(RoomTrack).filter(
                RoomTrack.id == room.now_playing_track_id
            ).first()
            if not track:
                return None

            # Если playback_started_at нет — просто стартуем с 0
            if room.playback_started_at:
                started_ts = room.playback_started_at.timestamp()
                # accumulated = 0, started_at = запись из БД
                state = TrackTimelineState(
                    track_id=track.id,
                    started_at=started_ts,
                    accumulated_offset=0.0,
                    is_playing=room.is_playing,
                )
            else:
                # Нет времени старта — начинаем с сейчас
                state = self.start_track(room_id, track.id)

            return state
        finally:
            db.close()

    def persist_to_db(self, room_id: int, state: TrackTimelineState) -> bool:
        """
        Сохранить timeline state в DB.

        Это делается при:
        - advance_track (новый трек)
        - pause/resume
        - периодически для recovery

        Возвращает True если успешно.
        """
        # Use controller as authoritative mutator to keep single source of truth
        try:
            from app.playback.controller import set_now_playing
            # set_now_playing will write now_playing and playback_started_at atomically
            ok = set_now_playing(room_id, state.track_id)
            return bool(ok)
        except Exception as e:
            print(f"timeline persist error (controller): {e}")
            return False

    # ── Drift detection ────────────────────────────────────────────────────────

    def get_drift(self, room_id: int, client_position: float,
                  client_server_time: Optional[float] = None) -> Optional[float]:
        """
        Вычислить рассинхрон между клиентом и сервером.

        client_server_time: время сервера когда клиент отправил свой position
        (для latency compensation)

        Returns: drift в секундах (положительный = клиент впереди)
        """
        state = self.get_current_state(room_id)
        if not state:
            return None

        now = time.time()
        server_position = state.get_position(now)

        drift = client_position - server_position

        # Latency compensation: если пришло client_server_time,
        # компенсируем half of RTT
        if client_server_time:
            latency = (now - client_server_time) / 2
            drift -= latency

        return drift


# ──────────────────────────────────────────────────────────────────────────────
#  Global instance
# ──────────────────────────────────────────────────────────────────────────────

timeline_manager = RoomTimelineManager()