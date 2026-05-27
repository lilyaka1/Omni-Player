"""
Playback Sync Service — heartbeat system + timeline/gateway integration.

Отвечает за:
- периодический broadcast track_sync через RoomGateway
- интеграцию timeline с playback loop (auto-advance)
- reconnect snapshot с position

Архитектура:
    PlaybackLoop (next_track) → sync_service.on_track_started(room_id, track_id)
    heartbeat (every 5s) → timeline.get_sync_payload() → RoomGateway.broadcast(track_sync)
"""

from __future__ import annotations

import asyncio
import threading
import time
from typing import Dict, Optional

from app.playback.timeline import timeline_manager

# Lazy import для избежания circular imports
_gateway = None
_loop = None


def _get_gateway():
    global _gateway
    if _gateway is None:
        try:
            from app.realtime.room_gateway import room_gateway
            _gateway = room_gateway
        except ImportError:
            pass
    return _gateway


def _get_loop():
    global _loop
    if _loop is None:
        try:
            from app.playback.loop import playback_loop
            _loop = playback_loop
        except ImportError:
            pass
    return _loop


class SyncService:
    """
    Playback sync service — heartbeat + timeline integration.

    Запускается при старте приложения и работает до shutdown.
    """

    HEARTBEAT_INTERVAL = 5.0  # seconds

    def __init__(self):
        self._running = False
        self._task: Optional[asyncio.Task] = None
        self._shutdown_event = threading.Event()

        # room_id → last broadcast position (для оптимизации)
        self._last_broadcast: Dict[int, float] = {}

    # ── Lifecycle ──────────────────────────────────────────────────────────────

    def start(self):
        """Запустить sync service (вызывается при старте приложения)."""
        if self._running:
            return

        self._running = True
        self._shutdown_event.clear()

        try:
            loop = asyncio.get_event_loop()
            if loop.is_running():
                self._task = loop.create_task(self._heartbeat_loop())
            else:
                loop.run_until_complete(self._heartbeat_loop())
        except RuntimeError:
            # Нет event loop — запустим в отдельном потоке
            t = threading.Thread(target=self._heartbeat_thread, daemon=True)
            t.start()

    def stop(self):
        """Остановить sync service."""
        self._running = False
        self._shutdown_event.set()
        if self._task:
            try:
                self._task.cancel()
            except Exception:
                pass

    # ── Track lifecycle events (called from PlaybackLoop / controller) ────────

    def on_track_started(self, room_id: int, track_id: int):
        """
        Called when a new track starts playing.

        Resets timeline + immediately broadcasts sync to all clients.
        """
        state = timeline_manager.start_track(room_id, track_id)
        timeline_manager.persist_to_db(room_id, state)
        # Immediately sync — clients need to know the new track right now
        self._broadcast_sync(room_id, state)

    def on_track_paused(self, room_id: int):
        """Called when playback pauses."""
        state = timeline_manager.pause(room_id)
        if state:
            timeline_manager.persist_to_db(room_id, state)
            self._broadcast_sync(room_id, state)

    def on_track_resumed(self, room_id: int):
        """Called when playback resumes."""
        state = timeline_manager.resume(room_id)
        if state:
            timeline_manager.persist_to_db(room_id, state)
            self._broadcast_sync(room_id, state)

    def on_track_seek(self, room_id: int, position: float):
        """Called when a user seeks."""
        state = timeline_manager.seek(room_id, position)
        if state:
            timeline_manager.persist_to_db(room_id, state)
            self._broadcast_sync(room_id, state)

    def on_track_stopped(self, room_id: int):
        """Called when playback stops."""
        timeline_manager.stop(room_id)
        self._broadcast_playback_stopped(room_id)

    # ── Reconnect snapshot ──────────────────────────────────────────────────────

    def get_reconnect_payload(self, room_id: int) -> Optional[dict]:
        """
        Получить payload для reconnect snapshot.

        Используется в RoomGateway.send_snapshot().
        Возвращает now_playing с position.
        """
        payload = timeline_manager.get_sync_payload(room_id)

        # Если timeline пустой — пробуем восстановить из DB
        if payload is None:
            state = timeline_manager.sync_from_db(room_id)
            if state:
                payload = state.to_snapshot()

        return payload

    # ── Heartbeat ──────────────────────────────────────────────────────────────

    async def _heartbeat_loop(self):
        """Периодический broadcast sync для всех активных комнат."""
        while self._running and not self._shutdown_event.is_set():
            try:
                await asyncio.sleep(self.HEARTBEAT_INTERVAL)
            except asyncio.CancelledError:
                break

            if not self._running:
                break

            await self._broadcast_all_active()

    def _heartbeat_thread(self):
        """Fallback thread-based heartbeat для случаев без asyncio loop."""
        while self._running and not self._shutdown_event.is_set():
            time.sleep(self.HEARTBEAT_INTERVAL)
            if not self._running:
                break
            try:
                self._broadcast_all_sync()
            except Exception as e:
                print(f"heartbeat error: {e}")

    async def _broadcast_all_active(self):
        """Broadcast sync для всех активных комнат."""
        gateway = _get_gateway()
        if not gateway:
            return

        # Собираем все room_id с активным timeline
        active_rooms = []
        for room_id in list(timeline_manager._states.keys()):
            if timeline_manager.has_active_timeline(room_id):
                active_rooms.append(room_id)

        for room_id in active_rooms:
            state = timeline_manager.get_current_state(room_id)
            if state:
                await self._broadcast_sync(room_id, state)

    def _broadcast_all_sync(self):
        """Sync version для thread context."""
        for room_id in list(timeline_manager._states.keys()):
            if timeline_manager.has_active_timeline(room_id):
                state = timeline_manager.get_current_state(room_id)
                if state:
                    self._broadcast_sync(room_id, state)

    def _broadcast_sync(self, room_id: int, state):
        """Broadcast track_sync в конкретную комнату."""
        gateway = _get_gateway()
        if not gateway:
            return

        now = time.time()
        payload = state.to_snapshot(now)

        # Skip если позиция не изменилась (dedup)
        last = self._last_broadcast.get(room_id, -1)
        if abs(payload["position"] - last) < 0.01:
            return

        self._last_broadcast[room_id] = payload["position"]

        msg = {
            "type": "track_sync",
            "room_id": room_id,
            "payload": payload,
        }

        # Вызываем broadcast асинхронно
        try:
            loop = asyncio.get_running_loop()
            if loop.is_running():
                loop.create_task(gateway._broadcast(room_id, msg))
        except RuntimeError:
            pass

    def _broadcast_playback_stopped(self, room_id: int):
        """Broadcast playback_stopped при остановке."""
        gateway = _get_gateway()
        if not gateway:
            return

        msg = {
            "type": "playback_stopped",
            "room_id": room_id,
            "payload": {},
        }
        try:
            loop = asyncio.get_running_loop()
            if loop.is_running():
                loop.create_task(gateway._broadcast(room_id, msg))
        except RuntimeError:
            pass


# ──────────────────────────────────────────────────────────────────────────────
#  Global instance
# ──────────────────────────────────────────────────────────────────────────────

sync_service = SyncService()