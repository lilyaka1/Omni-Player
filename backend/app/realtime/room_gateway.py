"""
Realtime Room Sync Layer — RoomGateway.

Нервная система комнаты: синхронизирует состояние комнаты со всеми клиентами.

Принцип:
- Gateway читает DB state + playback events
- Отправляет в существующий ConnectionManager
- Не управляет playback, не трогает DB напрямую

Архитектура:
    User Action
         ↓
    RoomService
         ↓
    PlaybackLoop
         ↓
    PlaybackController (DB)
         ↓
    RoomGateway (THIS LAYER)  ← подписывается на events
         ↓
    ConnectionManager (broadcast)
         ↓
    WebSocket Clients
"""

from __future__ import annotations

import asyncio
import json
import threading
from typing import Any, Dict, List, Optional

# Модуль realtime создаётся — проверим что ConnectionManager доступен
try:
    from app.websocket.manager import manager as _ws_manager
except ImportError:
    _ws_manager = None

# Playback controller event hooks
try:
    from app.playback.controller import register_hook, unregister_hook
except ImportError:
    register_hook = unregister_hook = None


class RoomGateway:
    """
    Realtime sync gateway для комнат.

    Отвечает за:
    - подписку на playback events
    - broadcast state changes в WS
    - snapshot при подключении клиента
    - room isolation (события не утекают между комнатами)
    """

    def __init__(self, ws_manager=None):
        # WS manager — используем существующий или переданный
        self._ws = ws_manager or _ws_manager

        # room_id → set of sent event signatures (для dedup)
        # Ключ: (event_type, entity_id) → последний timestamp
        self._sent_events: Dict[int, Dict[tuple, float]] = {}
        self._sent_lock = threading.Lock()

        # Подписываемся на playback events
        self._setup_playback_hooks()

    # ──────────────────────────────────────────────────────────────────────────
    #  Playback event integration
    # ──────────────────────────────────────────────────────────────────────────

    def _setup_playback_hooks(self):
        """Подписаться на playback controller events."""
        if register_hook is None:
            return

        def on_playback(room_id: int, payload: dict):
            event = payload.get("event", "")
            data = payload.get("data", {})

            if event == "started":
                self._broadcast_track_change(room_id, data.get("track_id"))
            elif event == "next":
                self._broadcast_track_change(room_id, data.get("track_id"))
            elif event == "set":
                self._broadcast_track_change(room_id, data.get("track_id"))
            elif event == "ended":
                self._broadcast_playback_ended(room_id)
            elif event == "stopped":
                self._broadcast_playback_stopped(room_id, data.get("prev_track_id"))

        self._playback_hook = on_playback
        register_hook(on_playback)

    # ──────────────────────────────────────────────────────────────────────────
    #  Broadcast methods
    # ──────────────────────────────────────────────────────────────────────────

    async def broadcast_room_state(self, room_id: int, state: dict):
        """
        Broadcast полного состояния комнаты.

        Используется при подключении клиента (snapshot).
        """
        if not self._ws:
            return

        msg = {
            "type": "state_snapshot",
            "room_id": room_id,
            "payload": state,
        }
        await self._ws.broadcast(room_id, json.dumps(msg))

    async def broadcast_track_change(self, room_id: int, track_id: int,
                                     track_data: Optional[dict] = None):
        """
        Broadcast смены трека.

        Если track_data не передан — читает из DB.
        """
        if not self._ws:
            return

        # Deduplication: не отправляем если уже отправляли тот же track_id
        if self._is_duplicate(room_id, "track_change", track_id):
            return

        if track_data is None:
            track_data = await self._fetch_track_info(track_id)

        if track_data is None:
            return

        msg = {
            "type": "track_change",
            "room_id": room_id,
            "payload": {
                "track_id": track_id,
                "track": track_data,
            },
        }
        await self._ws.broadcast(room_id, json.dumps(msg))

    async def broadcast_queue_update(self, room_id: int, queue: List[dict]):
        """Broadcast обновления очереди."""
        if not self._ws:
            return

        msg = {
            "type": "queue_update",
            "room_id": room_id,
            "payload": {"queue": queue},
        }
        await self._ws.broadcast(room_id, json.dumps(msg))

    async def broadcast_user_join(self, room_id: int, user_id: int,
                                  username: str, user_count: int):
        """Broadcast подключения пользователя."""
        if not self._ws:
            return

        msg = {
            "type": "user_join",
            "room_id": room_id,
            "payload": {
                "user_id": user_id,
                "username": username,
                "user_count": user_count,
            },
        }
        await self._ws.broadcast(room_id, json.dumps(msg))

    async def broadcast_user_leave(self, room_id: int, user_id: int,
                                   username: str, user_count: int):
        """Broadcast отключения пользователя."""
        if not self._ws:
            return

        msg = {
            "type": "user_leave",
            "room_id": room_id,
            "payload": {
                "user_id": user_id,
                "username": username,
                "user_count": user_count,
            },
        }
        await self._ws.broadcast(room_id, json.dumps(msg))

    # ──────────────────────────────────────────────────────────────────────────
    #  Snapshot sync (вызывается при подключении клиента)
    # ──────────────────────────────────────────────────────────────────────────

    async def send_snapshot(self, room_id: int, websocket, user_role: str = "user"):
        """
        Отправить полный snapshot состояния комнаты подключившемуся клиенту.

        Snapshots отправляются напрямую клиенту (не broadcast),
        чтобы гарантировать fresh state при каждом reconnect.
        """
        from app.database.session import SessionLocal
        from app.database.models import Room, RoomTrack
        from app.domains.rooms.service import RoomService

        db = SessionLocal()
        try:
            room = db.query(Room).filter(Room.id == room_id).first()
            if not room:
                return

            service = RoomService(db)
            room_state = service.get_room_state(room_id)

            if room_state is None:
                return

            # Собираем queue
            queue_tracks = (
                db.query(RoomTrack)
                .filter(RoomTrack.room_id == room_id)
                .order_by(RoomTrack.order.nullsfirst(), RoomTrack.id)
                .all()
            )
            queue = [
                {
                    "id": t.id,
                    "title": t.title,
                    "artist": t.artist,
                    "duration": t.duration or 0,
                    "thumbnail": t.thumbnail or "",
                    "genre": t.genre or "",
                    "order": t.order,
                }
                for t in queue_tracks
            ]

            snapshot = {
                "room_id": room.id,
                "name": room.name,
                "users": room_state.get("users", []),
                "user_count": room_state.get("user_count", 0),
                "now_playing": room_state.get("now_playing"),
                "is_playing": room_state.get("is_playing", False),
                "queue": queue,
                "queue_empty": room_state.get("queue_empty", True),
                "user_role": user_role,
            }

            await websocket.send_json({
                "type": "state_snapshot",
                "room_id": room_id,
                "payload": snapshot,
            })
        finally:
            db.close()

    # ──────────────────────────────────────────────────────────────────────────
    #  Internal helpers
    # ──────────────────────────────────────────────────────────────────────────

    def _is_duplicate(self, room_id: int, event_type: str, entity_id: Any) -> bool:
        """
        Deduplication: True если событие уже отправлялось недавно.

        Защита от дублирующих broadcast если event + polling
        одновременно сработали.
        """
        import time
        key = (event_type, entity_id)
        now = time.time()

        with self._sent_lock:
            if room_id not in self._sent_events:
                self._sent_events[room_id] = {}

            room_events = self._sent_events[room_id]
            last_sent = room_events.get(key, 0)

            if now - last_sent < 0.5:  # 500ms dedup window
                return True

            room_events[key] = now
            return False

    async def _fetch_track_info(self, track_id: int) -> Optional[dict]:
        """Прочитать информацию о треке из DB."""
        from app.database.session import SessionLocal
        from app.database.models import RoomTrack

        db = SessionLocal()
        try:
            track = db.query(RoomTrack).filter(RoomTrack.id == track_id).first()
            if not track:
                return None
            return {
                "id": track.id,
                "title": track.title,
                "artist": track.artist,
                "duration": track.duration or 0,
                "thumbnail": track.thumbnail or "",
                "genre": track.genre or "",
            }
        finally:
            db.close()

    # ──────────────────────────────────────────────────────────────────────────
    #  Playback event handlers (internal, called from hooks)
    # ──────────────────────────────────────────────────────────────────────────

    def _broadcast_track_change(self, room_id: int, track_id: int):
        """Асинхронный broadcast смены трека (вызывается из hook)."""
        if not self._ws:
            return
        try:
            loop = asyncio.get_running_loop()
        except RuntimeError:
            return
        if loop.is_running():
            loop.create_task(self.broadcast_track_change(room_id, track_id))

    def _broadcast_playback_ended(self, room_id: int):
        """Сообщить клиентам что playback завершён (очередь пуста)."""
        if not self._ws:
            return
        try:
            loop = asyncio.get_running_loop()
        except RuntimeError:
            return
        if loop.is_running():
            loop.create_task(self._broadcast(room_id, {
                "type": "playback_ended",
                "room_id": room_id,
                "payload": {},
            }))

    def _broadcast_playback_stopped(self, room_id: int, prev_track_id: Optional[int]):
        """Сообщить клиентам что playback остановлен вручную."""
        if not self._ws:
            return
        try:
            loop = asyncio.get_running_loop()
        except RuntimeError:
            return
        if loop.is_running():
            loop.create_task(self._broadcast(room_id, {
                "type": "playback_stopped",
                "room_id": room_id,
                "payload": {"prev_track_id": prev_track_id},
            }))

    async def _broadcast(self, room_id: int, msg: dict):
        """Низкоуровневый broadcast dict как JSON."""
        if self._ws:
            await self._ws.broadcast(room_id, json.dumps(msg))


# ──────────────────────────────────────────────────────────────────────────────
#  Singleton
# ──────────────────────────────────────────────────────────────────────────────

room_gateway = RoomGateway()