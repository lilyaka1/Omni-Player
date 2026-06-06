"""
Room Auto-Play Loop Service — HARDENED edition.

Всё что было в базовой версии, плюс:

1. Double-loop protection    — global registry, ignore если уже запущен
2. Double-advance protection  — advance_lock per room, only one advance at a time
3. Safe recovery             — consistency check НЕ трогает playing track
4. Graceful shutdown         — cancellation token, всё останавливается чисто

Event-driven с polling fallback.
Idempotent: повторные register/unregister/advance — не ломают state.
"""

from __future__ import annotations

import asyncio
import threading
import time
from typing import Dict, Optional

from app.playback.controller import (
    advance_playback,
    ensure_playback_consistency,
    get_now_playing,
    is_queue_empty,
    register_hook,
    start_playback,
    unregister_hook,
)


# ──────────────────────────────────────────────────────────────────────────────
#  Advance guard (singleton) — один advance на всю систему за раз
# ──────────────────────────────────────────────────────────────────────────────

class _AdvanceGuard:
    """
    Глобальный mutex для advance операций.

    Защищает от одновременного вызова advance_playback
    из event + polling одновременно.

    Per-room + global lock layering:
    - _room_advancing[room_id] — флаг "advance в процессе для комнаты"
    - _global_lock — сериализует доступ к флагам
    """

    def __init__(self):
        self._room_advancing: Dict[int, bool] = {}
        self._global_lock = threading.Lock()

    def begin(self, room_id: int) -> bool:
        """
        Попытка начать advance для комнаты.

        Returns:
            True — advance разрешён (first caller), можно работать.
            False — advance уже идёт для этой комнаты, skip.
        """
        with self._global_lock:
            if self._room_advancing.get(room_id, False):
                return False
            self._room_advancing[room_id] = True
            return True

    def end(self, room_id: int):
        """Завершить advance для комнаты (вызывать ВСЕГДА после begin)."""
        with self._global_lock:
            self._room_advancing[room_id] = False

    def is_advancing(self, room_id: int) -> bool:
        with self._global_lock:
            return self._room_advancing.get(room_id, False)


_advance_guard = _AdvanceGuard()


# ──────────────────────────────────────────────────────────────────────────────
#  Main class
# ──────────────────────────────────────────────────────────────────────────────

class RoomPlaybackLoopManager:
    """
    Production-hardened auto-play loop manager.

    Защищён от:
    - double loop start          (room_id registry + ignore)
    - double advance (race)      (_AdvanceGuard)
    - invalid recovery           (safe_consistency_check)
    - dangling tasks on shutdown  (CancellationToken)
    """

    def __init__(self):
        # room_id → asyncio.Task
        self._loops: Dict[int, asyncio.Task] = {}
        # room_id → asyncio.Lock (double-start guard)
        self._loop_locks: Dict[int, asyncio.Lock] = {}
        # room_id → asyncio.Event (cancellation token для shutdown)
        self._cancel_events: Dict[int, asyncio.Event] = {}
        # общий meta-lock для всех словарей
        self._meta_lock = threading.Lock()

        self._event_hook = self._make_hook()
        register_hook(self._event_hook)

    # ──────────────────────────────────────────────────────────────────────────
    #  Event hook
    # ──────────────────────────────────────────────────────────────────────────

    def _make_hook(self):
        def hook(room_id: int, payload: dict):
            event = payload.get("event")
            if event == "ended":
                # event-driven: планируем advance (если не уже в процессе)
                self._schedule_advance(room_id)
            # started / next / set / stopped — ничего не делаем

        return hook

    def _schedule_advance(self, room_id: int):
        """Планирует advance в ближайшем витке event loop."""
        try:
            loop = asyncio.get_running_loop()
        except RuntimeError:
            return

        if loop.is_running():
            loop.call_soon_threadsafe(self._do_advance, room_id)

    def _do_advance(self, room_id: int):
        """Выполняет advance через advance guard."""
        # Проверяем что для комнаты есть активный loop
        if room_id not in self._loops:
            return

        # Запускаем advance в отдельном таске (не в таске loop — это важно,
        # чтобы advance не блокировал idle loop)
        try:
            loop = asyncio.get_running_loop()
        except RuntimeError:
            return

        loop.create_task(self._advance_task(room_id))

    async def _advance_task(self, room_id: int):
        """
        Асинхронный advance с защитой от race.

        Порядок:
        1. acquire advance guard (only one at a time per room)
        2. sleep 0.1s (стабилизация после события)
        3. advance
        4. loop продолжает работать — не останавливаем, потому что
           пользователь может добавить треки позже.
        """
        if not _advance_guard.begin(room_id):
            # Другой advance уже идёт — skip
            return

        try:
            await asyncio.sleep(0.1)
            new_id = await asyncio.to_thread(advance_playback, room_id)
            if new_id is None:
                print(f"ℹ️ [loop] Room {room_id}: queue empty after advance, loop stays alive")
                # Очередь закончилась — но loop продолжает работать.
                # playback_tick каждые 5 сек проверит, появились ли треки.
        except Exception:
            pass
        finally:
            _advance_guard.end(room_id)

    # ──────────────────────────────────────────────────────────────────────────
    #  Public API — register / unregister
    # ──────────────────────────────────────────────────────────────────────────

    def register_room(self, room_id: int) -> bool:
        """
        Запустить auto-play loop для комнаты.

        При старте:
        1. Recovery: ensure_playback_consistency
        2. Если now_playing == NULL и очередь не пуста → start_playback()
        3. Запустить idle loop

        Idempotent: повторный вызов — no-op.

        Returns:
            True если loop запущен или уже был активен.
            False если комната не найдена или очередь пуста.
        """
        # Recovery в синхронном потоке до запуска loop
        track_id = ensure_playback_consistency(room_id)
        if track_id is None:
            track_id = start_playback(room_id)
        if track_id is None:
            return False

        # Safe task creation — works from any async context (FastAPI, background thread)
        try:
            loop = asyncio.get_running_loop()
            loop.create_task(self._start_loop(room_id))
        except RuntimeError:
            # No running loop (e.g. exec outside FastAPI) — use default loop
            try:
                asyncio.get_event_loop().run_in_executor(None, lambda: None)
                asyncio.get_event_loop().create_task(self._start_loop(room_id))
            except Exception:
                pass  # Will be started on next request or via WS join

        return True

    async def _start_loop(self, room_id: int):
        """Запуск loop с double-start защитой и немедленной проверкой."""
        lock = self._get_lock(room_id)

        async with lock:
            # --- DOUBLE LOOP PROTECTION ---
            if room_id in self._loops and not self._loops[room_id].done():
                return  # Уже запущен — ignore

            print(f"🔄 [loop] Room {room_id}: _start_loop begin")

            cancel_ev = asyncio.Event()
            with self._meta_lock:
                self._cancel_events[room_id] = cancel_ev

            task = asyncio.create_task(self._run_with_immediate_check(room_id, cancel_ev))
            with self._meta_lock:
                self._loops[room_id] = task
            print(f"✅ [loop] loop started room={room_id}")
            print(f"✅ [loop] Room {room_id}: loop task created, now playing check pending")

    async def _run_with_immediate_check(self, room_id: int, cancel_ev: asyncio.Event):
        """
        Wrapper вокруг _loop — делает immediate consistency check на первом витке.
        
        Это решает 5-секундный gap: до исправления, первый sync consistency check
        происходил только через 5 секунд после join. Теперь — сразу.
        """
        # --- IMMEDIATE CHECK (before first 5s sleep) ---
        try:
            from app.playback.controller import playback_tick
            await asyncio.to_thread(playback_tick, room_id)
            print(f"⏱️ [loop] Room {room_id}: immediate playback tick done")
        except Exception as e:
            print(f"⚠️ [loop] Room {room_id}: immediate check error: {e}")

        # Broadcast current state to any late-connecting clients
        await self._broadcast_current_track(room_id)

        # Now run the normal idle loop
        await self._loop(room_id, cancel_ev)

    async def _broadcast_current_track(self, room_id: int):
        """
        Broadcast текущий now_playing для поздно-подключившихся клиентов.
        Вызывается сразу при старте loop, до первого 5s sleep.
        """
        try:
            from app.database.models import Room
            from app.database.session import SessionLocal

            def _fetch():
                db = SessionLocal()
                try:
                    room = db.query(Room).filter(Room.id == room_id).first()
                    now_playing = get_now_playing(room_id)
                    sess = None
                    try:
                        from app.playback.controller import get_playback_session
                        sess = get_playback_session(room_id)
                    except Exception:
                        pass
                    return room, now_playing, sess
                finally:
                    db.close()

            room, now_playing, sess = await asyncio.to_thread(_fetch)

            if now_playing:
                from app.websocket.manager import manager
                track_dict = {
                    "id": now_playing.id,
                    "title": now_playing.title,
                    "artist": now_playing.artist,
                    "duration": now_playing.duration,
                    "thumbnail": now_playing.thumbnail or '',
                    "genre": now_playing.genre or '',
                    "started_at": (
                        room.playback_started_at.isoformat()
                        if room and room.playback_started_at else None
                    ),
                }
                data = {"track": track_dict}
                if sess:
                    data["generation"] = sess.generation
                    data["playback_state"] = sess.playback_state
                await manager.broadcast_event(room_id, 'track_changed', data, generation=(sess.generation if sess else None))
                print(f"📡 [loop] Room {room_id}: immediate broadcast → '{now_playing.title}' started_at={track_dict['started_at']}")
        except Exception as e:
            print(f"⚠️ [loop] Room {room_id}: broadcast error: {e}")

    async def _loop(self, room_id: int, cancel_ev: asyncio.Event):
        """
        Idle loop с cancellation support.

        Не busy-polling: спит 5 секунд, потом проверяет состояние.
        Cancellation проверяется на КАЖДОЙ итерации.

        Recovery логика:
        - НЕ трогает playing track если он валиден
        - только чинит NULL / invalid now_playing
        """
        try:
            while True:
                # --- GRACEFUL SHUTDOWN: проверяем cancellation перед sleep ---
                if cancel_ev.is_set():
                    break

                # Sleep с проверкой cancellation (long sleep прерывается)
                try:
                    await asyncio.wait_for(cancel_ev.wait(), timeout=5.0)
                    # cancel_ev сработал во время sleep
                    break
                except asyncio.TimeoutError:
                    pass  # 5 сек прошли — продолжаем

                # --- CANCELLATION CHECK после каждого sleep ---
                if cancel_ev.is_set():
                    break

                # --- Playback tick: deterministic state machine ---
                try:
                    from app.playback.controller import playback_tick
                    await asyncio.to_thread(playback_tick, room_id)
                except Exception:
                    pass

        except asyncio.CancelledError:
            # Получили explicit cancel
            pass
        finally:
            self._cleanup(room_id)

    def _safe_consistency_check(self, room_id: int):
        """
        Безопасный consistency check.

        Правило: НИКОГДА не менять now_playing если трек играет валидный.

        Что чиним:
        - now_playing == NULL
        - now_playing указывает на несуществующий трек

        Что НЕ чиним:
        - валидный playing трек
        """
        track = get_now_playing(room_id)
        if track is not None:
            return  # Всё ок — playing track валиден, не трогаем

        if is_queue_empty(room_id):
            return  # Очередь пуста, нечего чинить

        # now_playing NULL и очередь не пуста → запускаем
        # Before starting playback, reconcile queue items (failed assets → failed)
        try:
            from app.playback.controller import reconcile_queue
            reconcile_queue(room_id)
        except Exception:
            pass

        start_playback(room_id)

    # ──────────────────────────────────────────────────────────────────────────

    def unregister_room(self, room_id: int) -> bool:
        """
        Остановить loop для комнаты.

        Idempotent: повторный вызов — no-op.

        Returns:
            True если был активный loop, False если не было.
        """
        had_loop = self._stop_loop(room_id)
        return had_loop

    def _stop_loop(self, room_id: int) -> bool:
        """Синхронная остановка — вызывается из любого потока."""
        with self._meta_lock:
            if room_id not in self._loops:
                return False
            task = self._loops[room_id]

        # Сигналим cancellation event
        cancel_ev = self._cancel_events.get(room_id)
        if cancel_ev:
            cancel_ev.set()

        # Отменяем task если ещё работает
        if not task.done():
            task.cancel()

        self._cleanup(room_id)
        return True

    def _cleanup(self, room_id: int):
        """Очистить все ресурсы комнаты."""
        with self._meta_lock:
            self._loops.pop(room_id, None)
            self._cancel_events.pop(room_id, None)

    def _get_lock(self, room_id: int) -> asyncio.Lock:
        with self._meta_lock:
            if room_id not in self._loop_locks:
                self._loop_locks[room_id] = asyncio.Lock()
            return self._loop_locks[room_id]

    # ──────────────────────────────────────────────────────────────────────────
    #  Manual trigger (для внешних систем: stream / ffmpeg)
    # ──────────────────────────────────────────────────────────────────────────

    def on_track_finished(self, room_id: int) -> Optional[int]:
        """
        Ручной триггер окончания трека.

        Проходит через advance guard — безопасен при повторе.
        Возвращает None если advance залочен другим процессом.

        Returns:
            Новый track_id, None если очередь пуста или advance в процессе.
        """
        # Синхронная версия с тем же guard
        if not _advance_guard.begin(room_id):
            return None  # Уже идёт advance — skip

        try:
            return advance_playback(room_id)
        finally:
            _advance_guard.end(room_id)

    # ──────────────────────────────────────────────────────────────────────────
    #  Shutdown (вызвать при остановке приложения)
    # ──────────────────────────────────────────────────────────────────────────

    def shutdown(self):
        """
        Полный graceful shutdown всех loop-ов.

        Каждый loop получит CancelledError и завершится чисто.
        """
        with self._meta_lock:
            room_ids = list(self._loops.keys())

        for room_id in room_ids:
            self.unregister_room(room_id)

        unregister_hook(self._event_hook)


# ──────────────────────────────────────────────────────────────────────────────
#  Singleton
# ──────────────────────────────────────────────────────────────────────────────

playback_loop = RoomPlaybackLoopManager()