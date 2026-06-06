"""
Queue Concurrency & Conflict Resolution Layer.

Transaction-safe queue operations с optimistic versioning + per-room locking.

Принцип:
- Все операции — под per-room mutex (threading.Lock)
- Deduplication по (room_id, track_id) при добавлении
- queue_version инкрементируется при каждом mutate
- Опциональный FOR UPDATE через SessionLocal (для будущего pgbouncer)

Архитектура:
    RoomService → QueueService → DB (RoomTrack + Room.queue_version)
    PlaybackLoop → QueueService.get_next_track()
    RoomGateway → подписывается на queue_update события
"""

from __future__ import annotations

import threading
import time
import uuid
from dataclasses import dataclass
from datetime import datetime
from typing import Dict, List, Optional, Tuple

from sqlalchemy import desc, func

from app.database.session import SessionLocal
from app.database.models import Room, RoomTrack


# ──────────────────────────────────────────────────────────────────────────────
#  Concurrency primitives
# ──────────────────────────────────────────────────────────────────────────────

class _RoomLocks:
    """Per-room locks — защита от concurrent queue mutations."""

    def __init__(self):
        self._locks: Dict[int, threading.RLock] = {}
        self._meta = threading.RLock()  # для доступа к _locks

    def get(self, room_id: int) -> threading.RLock:
        with self._meta:
            if room_id not in self._locks:
                self._locks[room_id] = threading.RLock()
            return self._locks[room_id]

    def release_room(self, room_id: int):
        """Освободить и удалить lock при shutdown комнаты."""
        with self._meta:
            self._locks.pop(room_id, None)


_room_locks = _RoomLocks()


# ──────────────────────────────────────────────────────────────────────────────
#  Result types
# ──────────────────────────────────────────────────────────────────────────────

@dataclass
class QueueResult:
    """Standard result envelope для всех queue operations."""
    ok: bool
    queue: List[dict]
    version: int
    changed_by: Optional[int] = None
    error: Optional[str] = None
    conflict: bool = False  # True = stale version, needs retry


# ──────────────────────────────────────────────────────────────────────────────
#  QueueService
# ──────────────────────────────────────────────────────────────────────────────

class QueueService:
    """
    Transaction-safe queue operations.

    Все методы:
    - под per-room RLock
    - инкрементируют queue_version
    - возвращают QueueResult с актуальной queue + version
    """

    def __init__(self):
        pass

    # ── Internal ───────────────────────────────────────────────────────────────

    def _get_lock(self, room_id: int) -> threading.RLock:
        return _room_locks.get(room_id)

    def _fetch_room_and_version(self, db) -> Tuple[Optional[Room], int]:
        """Получить room + текущий queue_version."""
        room = db.query(Room).filter(Room.id).first()
        version = room.queue_version if room else 0
        return room, version

    def _increment_version(self, db, room: Room) -> int:
        """Инкрементировать queue_version. Вызывать под lock."""
        room.queue_version = (room.queue_version or 0) + 1
        db.commit()
        return room.queue_version

    def _read_queue(self, db, room_id: int) -> List[dict]:
        """Прочитать текущую очередь (без изменения). Вызывать под lock."""
        tracks = (
            db.query(RoomTrack)
            .filter(RoomTrack.room_id == room_id)
            .order_by(RoomTrack.order.nullsfirst(), RoomTrack.id)
            .all()
        )
        return [self._track_to_dict(t) for t in tracks]

    def _track_to_dict(self, t: RoomTrack) -> dict:
        return {
            "id": t.id,
            "title": t.title,
            "artist": t.artist,
            "duration": t.duration or 0,
            "thumbnail": t.thumbnail or "",
            "genre": t.genre or "",
            "order": t.order,
            "added_by_id": t.added_by_id,
            "source_track_id": t.source_track_id,
        }

    def _current_version(self, db, room_id: int) -> int:
        room = db.query(Room).filter(Room.id == room_id).first()
        return room.queue_version if room else 0

    # ── Public API ─────────────────────────────────────────────────────────────

    def get_queue(self, room_id: int) -> QueueResult:
        """
        Read-only получение очереди.

        Returns: QueueResult(ok=True, queue=[...], version=N)
        """
        with self._get_lock(room_id):
            db = SessionLocal()
            try:
                room = db.query(Room).filter(Room.id == room_id).first()
                if not room:
                    return QueueResult(ok=False, queue=[], version=0, error="room_not_found")
                queue = self._read_queue(db, room_id)
                return QueueResult(
                    ok=True,
                    queue=queue,
                    version=room.queue_version or 0,
                )
            finally:
                db.close()

    def add_track(
        self,
        room_id: int,
        user_id: int,
        track_data: dict,
        allow_duplicates: bool = False,
    ) -> QueueResult:
        """
        Добавить трек в конец очереди.

        Args:
            room_id, user_id, track_data (dict with: title, artist, duration,
                thumbnail, genre, source_track_id, stream_url)
            allow_duplicates: если False — deduplicate по source_track_id

        Returns: QueueResult с обновлённой очередью + version
        """
        with self._get_lock(room_id):
            db = SessionLocal()
            try:
                room = db.query(Room).filter(Room.id == room_id).first()
                if not room:
                    return QueueResult(ok=False, queue=[], version=0, error="room_not_found")

                source_track_id = track_data.get("source_track_id") or str(track_data.get("id", uuid.uuid4().hex[:12]))

                # Deduplication (если не allow_duplicates)
                if not allow_duplicates:
                    existing = db.query(RoomTrack).filter(
                        RoomTrack.room_id == room_id,
                        RoomTrack.source_track_id == source_track_id,
                    ).first()
                    if existing:
                        # Возвращаем текущую очередь без изменений
                        queue = self._read_queue(db, room_id)
                        return QueueResult(
                            ok=True,
                            queue=queue,
                            version=room.queue_version or 0,
                            changed_by=user_id,
                        )

                # max order
                max_order = (
                    db.query(func.max(RoomTrack.order))
                    .filter(RoomTrack.room_id == room_id)
                    .scalar()
                    or 0
                )

                track = RoomTrack(
                    room_id=room_id,
                    source=track_data.get("source", "soundcloud"),
                    source_track_id=source_track_id,
                    title=track_data.get("title", "Unknown"),
                    artist=track_data.get("artist", "Unknown"),
                    duration=track_data.get("duration", 0) or 0,
                    # NO-OP: do not persist provided stream_url here to avoid
                    # creating playable state outside ingestion/controller.
                    stream_url="",
                    thumbnail=track_data.get("thumbnail", ""),
                    genre=track_data.get("genre", ""),
                    order=max_order + 1,
                    added_by_id=user_id,
                )
                db.add(track)
                version = self._increment_version(db, room)
                queue = self._read_queue(db, room_id)

                return QueueResult(
                    ok=True,
                    queue=queue,
                    version=version,
                    changed_by=user_id,
                )
            except Exception as e:
                db.rollback()
                return QueueResult(ok=False, queue=[], version=0, error=str(e))
            finally:
                db.close()

    def remove_track(self, room_id: int, queue_item_id: int, user_id: int) -> QueueResult:
        """
        Удалить трек из очереди.

        Returns: QueueResult с обновлённой очередью
        """
        with self._get_lock(room_id):
            db = SessionLocal()
            try:
                room = db.query(Room).filter(Room.id == room_id).first()
                if not room:
                    return QueueResult(ok=False, queue=[], version=0, error="room_not_found")

                track = db.query(RoomTrack).filter(
                    RoomTrack.id == queue_item_id,
                    RoomTrack.room_id == room_id,
                ).first()

                if not track:
                    return QueueResult(
                        ok=False, queue=self._read_queue(db, room_id),
                        version=room.queue_version or 0, error="track_not_found",
                    )

                db.delete(track)
                version = self._increment_version(db, room)
                queue = self._read_queue(db, room_id)

                return QueueResult(
                    ok=True, queue=queue, version=version, changed_by=user_id,
                )
            except Exception as e:
                db.rollback()
                return QueueResult(ok=False, queue=[], version=0, error=str(e))
            finally:
                db.close()

    def move_track(
        self,
        room_id: int,
        queue_item_id: int,
        to_order: int,
        user_id: int,
        expected_version: Optional[int] = None,
    ) -> QueueResult:
        """
        Переместить трек на новую позицию.

        Args:
            to_order: новая позиция в очереди (0-based)
            expected_version: если указано — проверка на stale update

        Returns: QueueResult с обновлённой очередью
        """
        with self._get_lock(room_id):
            db = SessionLocal()
            try:
                room = db.query(Room).filter(Room.id == room_id).first()
                if not room:
                    return QueueResult(ok=False, queue=[], version=0, error="room_not_found")

                # Optimistic concurrency check
                if expected_version is not None:
                    if room.queue_version != expected_version:
                        return QueueResult(
                            ok=False, queue=self._read_queue(db, room_id),
                            version=room.queue_version or 0,
                            error="stale_version",
                            conflict=True,
                        )

                track = db.query(RoomTrack).filter(
                    RoomTrack.id == queue_item_id,
                    RoomTrack.room_id == room_id,
                ).first()
                if not track:
                    return QueueResult(
                        ok=False, queue=self._read_queue(db, room_id),
                        version=room.queue_version or 0, error="track_not_found",
                    )

                # Получаем все треки отсортированные
                all_tracks = (
                    db.query(RoomTrack)
                    .filter(RoomTrack.room_id == room_id)
                    .order_by(RoomTrack.order.nullsfirst(), RoomTrack.id)
                    .all()
                )

                # Перестраиваем порядок
                tracks_list = list(all_tracks)
                track_map = {t.id: t for t in tracks_list}

                try:
                    from_idx = next(i for i, t in enumerate(tracks_list) if t.id == queue_item_id)
                except StopIteration:
                    from_idx = -1

                if from_idx < 0:
                    return QueueResult(
                        ok=False, queue=self._read_queue(db, room_id),
                        version=room.queue_version or 0, error="track_not_found",
                    )

                # Убираем с текущей позиции и вставляем на новую
                moved = tracks_list.pop(from_idx)
                insert_at = max(0, min(to_order, len(tracks_list)))
                tracks_list.insert(insert_at, moved)

                # Пересчитываем order
                for idx, t in enumerate(tracks_list):
                    t.order = idx

                version = self._increment_version(db, room)
                queue = self._read_queue(db, room_id)

                return QueueResult(
                    ok=True, queue=queue, version=version, changed_by=user_id,
                )
            except Exception as e:
                db.rollback()
                return QueueResult(ok=False, queue=[], version=0, error=str(e))
            finally:
                db.close()

    def reorder_queue(
        self,
        room_id: int,
        new_order: List[int],
        user_id: int,
        expected_version: Optional[int] = None,
    ) -> QueueResult:
        """
        Полная перестановка очереди.

        new_order: список queue_item_id в новом порядке.
        Все треки не из new_order — удаляются из очереди.

        Returns: QueueResult с обновлённой очередью
        """
        if not new_order:
            return QueueResult(ok=False, queue=[], version=0, error="empty_order")

        with self._get_lock(room_id):
            db = SessionLocal()
            try:
                room = db.query(Room).filter(Room.id == room_id).first()
                if not room:
                    return QueueResult(ok=False, queue=[], version=0, error="room_not_found")

                # Optimistic concurrency check
                if expected_version is not None:
                    if room.queue_version != expected_version:
                        return QueueResult(
                            ok=False, queue=self._read_queue(db, room_id),
                            version=room.queue_version or 0,
                            error="stale_version",
                            conflict=True,
                        )

                new_order_ids = set(int(x) for x in new_order)

                # Удаляем треки не в new_order
                db.query(RoomTrack).filter(
                    RoomTrack.room_id == room_id,
                    ~RoomTrack.id.in_(new_order_ids),
                ).delete(synchronize_session=False)

                # Присваиваем новые positions
                for idx, item_id in enumerate(new_order):
                    db.query(RoomTrack).filter(
                        RoomTrack.id == int(item_id),
                        RoomTrack.room_id == room_id,
                    ).update({"order": idx}, synchronize_session=False)

                version = self._increment_version(db, room)
                queue = self._read_queue(db, room_id)

                return QueueResult(
                    ok=True, queue=queue, version=version, changed_by=user_id,
                )
            except Exception as e:
                db.rollback()
                return QueueResult(ok=False, queue=[], version=0, error=str(e))
            finally:
                db.close()

    def clear_queue(self, room_id: int, user_id: int) -> QueueResult:
        """Очистить очередь (кроме текущего now_playing_track_id)."""
        with self._get_lock(room_id):
            db = SessionLocal()
            try:
                room = db.query(Room).filter(Room.id == room_id).first()
                if not room:
                    return QueueResult(ok=False, queue=[], version=0, error="room_not_found")

                # Удаляем всё кроме now_playing
                now_playing = room.now_playing_track_id
                query = db.query(RoomTrack).filter(RoomTrack.room_id == room_id)
                if now_playing:
                    query = query.filter(RoomTrack.id != now_playing)
                query.delete(synchronize_session=False)

                version = self._increment_version(db, room)
                queue = self._read_queue(db, room_id)

                return QueueResult(
                    ok=True, queue=queue, version=version, changed_by=user_id,
                )
            except Exception as e:
                db.rollback()
                return QueueResult(ok=False, queue=[], version=0, error=str(e))
            finally:
                db.close()

    # ── PlaybackLoop integration ───────────────────────────────────────────────

    def get_next_track(self, room_id: int) -> Optional[dict]:
        """
        Получить следующий трек для playback (без изменения queue).

        Используется PlaybackLoop для advance.
        Возвращает dict с track_data или None.
        """
        with self._get_lock(room_id):
            db = SessionLocal()
            try:
                room = db.query(Room).filter(Room.id == room_id).first()
                if not room:
                    return None

                current_id = room.now_playing_track_id
                current = (
                    db.query(RoomTrack).filter(RoomTrack.id == current_id).first()
                    if current_id else None
                )

                next_track = None
                if current:
                    if current.order is not None:
                        next_track = (
                            db.query(RoomTrack)
                            .filter(
                                RoomTrack.room_id == room_id,
                                RoomTrack.order > current.order,
                            )
                            .order_by(RoomTrack.order)
                            .first()
                        )
                    else:
                        next_track = (
                            db.query(RoomTrack)
                            .filter(
                                RoomTrack.room_id == room_id,
                                RoomTrack.id > current.id,
                            )
                            .order_by(RoomTrack.id)
                            .first()
                        )

                # Loop mode
                if not next_track and room.queue_mode == 'loop':
                    next_track = (
                        db.query(RoomTrack)
                        .filter(RoomTrack.room_id == room_id)
                        .order_by(RoomTrack.order.nullsfirst(), RoomTrack.id)
                        .first()
                    )

                if next_track:
                    return {
                        "id": next_track.id,
                        "title": next_track.title,
                        "artist": next_track.artist,
                        "duration": next_track.duration,
                        "thumbnail": next_track.thumbnail or '',
                        "genre": next_track.genre or '',
                        "stream_url": next_track.stream_url,
                        "source_track_id": next_track.source_track_id,
                        "order": next_track.order,
                    }
                return None
            finally:
                db.close()

    def get_queue_size(self, room_id: int) -> int:
        """Количество треков в очереди."""
        with self._get_lock(room_id):
            db = SessionLocal()
            try:
                return db.query(RoomTrack).filter(
                    RoomTrack.room_id == room_id
                ).count()
            finally:
                db.close()

    def peek_queue(self, room_id: int, limit: int = 5) -> List[dict]:
        """Следующие N треков (без изменения)."""
        with self._get_lock(room_id):
            db = SessionLocal()
            try:
                tracks = (
                    db.query(RoomTrack)
                    .filter(RoomTrack.room_id == room_id)
                    .order_by(RoomTrack.order.nullsfirst(), RoomTrack.id)
                    .limit(limit)
                    .all()
                )
                return [self._track_to_dict(t) for t in tracks]
            finally:
                db.close()


# ──────────────────────────────────────────────────────────────────────────────
#  Global instance
# ──────────────────────────────────────────────────────────────────────────────

queue_service = QueueService()
