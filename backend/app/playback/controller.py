"""
Playback Controller — управляет room.now_playing_track_id.

Единственная ответственность: запись ID трека в комнату.

Ничего не знает о stream, ffmpeg, файлах, WS, рекомендациях, fallback.
WS/stream слои читают DB state и сами решают что делать.

Архитектура:
    WS/Stream Layer
           ↓
    Playback Controller (меняет state)
           ↓
    DB (room.now_playing_track_id)
           ↓
    Stream endpoint читает текущее состояние
"""

import threading
from datetime import datetime
from typing import Callable, Optional, List

from app.database.models import Room, RoomTrack
from app.database.session import SessionLocal
from app.database.models import Track, TrackAsset
from sqlalchemy import and_, func
from app.database.models import PlaybackSession
from datetime import timedelta

# ──────────────────────────────────────────────────────────────────────────────
#  Event hooks (без WS внутри — WS слой сам решает что делать)
# ──────────────────────────────────────────────────────────────────────────────

# Список коллбеков: (event_name, callback)
# callback signature: (room_id: int, data: dict) -> None
_playback_hooks: List[tuple] = []


def on_playback_event(room_id: int, event: str, data: Optional[dict] = None):
    """Уведомить все подписанные хуки о событии playback."""
    payload = {"room_id": room_id, "event": event, "data": data or {}}
    for _, cb in _playback_hooks:
        try:
            cb(room_id, payload)
        except Exception:
            pass


def register_hook(callback: Callable[[int, dict], None]) -> None:
    """Подписать callback на playback события. Возвращает дерегистратор."""
    _playback_hooks.append((id(callback), callback))


def unregister_hook(callback: Callable[[int, dict], None]) -> None:
    """Отписать callback."""
    _playback_hooks[:] = [(k, v) for k, v in _playback_hooks if v != callback]


# ──────────────────────────────────────────────────────────────────────────────
#  Блокировка на уровне комнаты (anti-race)
# ──────────────────────────────────────────────────────────────────────────────

# Per-room mutex — защита от одновременных вызовов advance/start в разных потоках
_room_locks: dict[int, threading.RLock] = {}
_locks_lock = threading.Lock()


def _get_room_lock(room_id: int) -> threading.RLock:
    """Получить или создать RLock для конкретной комнаты (RLock допускает re-entrant)."""
    with _locks_lock:
        if room_id not in _room_locks:
            _room_locks[room_id] = threading.RLock()
        return _room_locks[room_id]


# ──────────────────────────────────────────────────────────────────────────
#  PlaybackSession helpers (canonical playback authority)
# ──────────────────────────────────────────────────────────────────────────


def get_playback_session(room_id: int) -> Optional[PlaybackSession]:
    db = SessionLocal()
    try:
        return db.query(PlaybackSession).filter(PlaybackSession.room_id == room_id).first()
    finally:
        db.close()


def _increment_generation(db, session_obj: PlaybackSession):
    try:
        session_obj.generation = (session_obj.generation or 0) + 1
        db.commit()
    except Exception:
        db.rollback()


_ALLOWED_TRANSITIONS = {
    'idle': ['playing', 'stopped'],
    'playing': ['stalled', 'played', 'skipped', 'failed', 'stopped'],
    'stalled': ['recovering', 'failed'],
    'recovering': ['playing', 'failed'],
    'failed': ['stopped'],
    'played': ['stopped'],
    'skipped': ['stopped'],
    'stopped': ['idle'],
}


def update_playback_session(room_id: int, new_state: str, current_queue_item_id: Optional[int] = None, expected_end_at=None) -> Optional[PlaybackSession]:
    """
    Atomically update/create PlaybackSession for a room with generation increment.
    Enforces allowed transitions and increments generation for each change.
    Returns the updated session.
    """
    lock = _get_room_lock(room_id)
    with lock:
        db = SessionLocal()
        try:
            sess = db.query(PlaybackSession).filter(PlaybackSession.room_id == room_id).with_for_update().first()
            if not sess:
                # create session
                sess = PlaybackSession(room_id=room_id, current_queue_item_id=current_queue_item_id, playback_state=new_state)
                if expected_end_at:
                    sess.expected_end_at = expected_end_at
                db.add(sess)
                db.commit()
                db.refresh(sess)
                return sess

            # Enforce allowed transitions
            cur = sess.playback_state or 'idle'
            if new_state != cur:
                allowed = _ALLOWED_TRANSITIONS.get(cur, [])
                if new_state not in allowed:
                    # If transition not allowed, ignore request
                    return sess

            # Apply update with optimistic concurrency guard: require generation matches current
            # Read current gen
            current_gen = sess.generation or 0

            # Perform conditional update: WHERE room_id==room_id AND generation==current_gen
            update_values = {
                PlaybackSession.playback_state: new_state,
                PlaybackSession.updated_at: datetime.utcnow(),
            }
            if current_queue_item_id is not None:
                update_values[PlaybackSession.current_queue_item_id] = current_queue_item_id
            if expected_end_at is not None:
                update_values[PlaybackSession.expected_end_at] = expected_end_at
            update_values[PlaybackSession.generation] = PlaybackSession.generation + 1

            rows = db.query(PlaybackSession).filter(PlaybackSession.room_id == room_id, PlaybackSession.generation == current_gen).update(update_values, synchronize_session=False)
            if rows == 0:
                # concurrent modification — caller should retry (we return None)
                db.rollback()
                return None

            db.commit()
            sess = db.query(PlaybackSession).filter(PlaybackSession.room_id == room_id).first()
            return sess
        finally:
            db.close()


def update_queue_state(room_track_id: int, new_state: str) -> bool:
    """Atomically update queue_state for a RoomTrack with transition validation."""
    db = SessionLocal()
    try:
        rt = db.query(RoomTrack).filter(RoomTrack.id == room_track_id).with_for_update().first()
        if not rt:
            return False
        cur = getattr(rt, 'queue_state', 'ready')
        allowed = _ALLOWED_TRANSITIONS.get(cur, [])
        if new_state == cur:
            return True
        if new_state not in allowed:
            return False
        rt.queue_state = new_state
        db.commit()
        return True
    finally:
        db.close()


# ──────────────────────────────────────────────────────────────────────────────
#  Core API
# ──────────────────────────────────────────────────────────────────────────────

def start_playback(room_id: int) -> Optional[int]:
    """
    Начать воспроизведение в комнате.

    Если now_playing_track_id уже установлен — ничего не делать (return текущий).
    Если очередь пуста — ничего не делать (return None).
    Иначе — взять первый трек по order и записать его ID.

    Returns:
        ID трека который играет, либо None (очередь пуста).
    """
    lock = _get_room_lock(room_id)
    with lock:
        db = SessionLocal()
        try:
            room = db.query(Room).filter(Room.id == room_id).with_for_update().first()
            if not room:
                return None

            if room.now_playing_track_id is not None:
                return room.now_playing_track_id

            # Deterministic selector: pick next queue item where queue_state
            # indicates readiness (ready or waiting_download) AND there exists
            # a TrackAsset in status 'ready' for the corresponding Track.
            # Join RoomTrack -> Track (by source/source_track_id) -> TrackAsset.
            # Case-insensitive source match to handle SOUNDCLOUD vs soundcloud mismatch.
            first = (
                db.query(RoomTrack)
                .join(Track, and_(func.lower(Track.source) == func.lower(RoomTrack.source), Track.source_track_id == RoomTrack.source_track_id))
                .join(TrackAsset, TrackAsset.track_id == Track.id)
                .filter(
                    RoomTrack.room_id == room_id,
                    RoomTrack.queue_state.in_(['ready', 'waiting_download']),
                    TrackAsset.status == 'ready',
                )
                .order_by(RoomTrack.order.nullsfirst(), RoomTrack.id)
                .first()
            )
            # Fallback: if no Track/TrackAsset pair found, fall back to direct
            # RoomTrack stream_url check (for tracks that have direct stream_url)
            if not first:
                first = (
                    db.query(RoomTrack)
                    .filter(
                        RoomTrack.room_id == room_id,
                        RoomTrack.queue_state == 'ready',
                        RoomTrack.stream_url != '',
                        RoomTrack.stream_url != None,
                    )
                    .order_by(RoomTrack.order.nullsfirst(), RoomTrack.id)
                    .first()
                )
            if not first:
                return None

            room.now_playing_track_id = first.id
            room.is_playing = True
            room.playback_started_at = datetime.utcnow()
            db.commit()

            # mark queue item as playing and create/update PlaybackSession (authority)
            try:
                update_queue_state(first.id, 'playing')
            except Exception:
                pass

            expected_end = None
            try:
                expected_end = datetime.utcnow() + timedelta(seconds=int(first.duration or 0))
            except Exception:
                expected_end = None

            try:
                update_playback_session(room_id, 'playing', current_queue_item_id=first.id, expected_end_at=expected_end)
            except Exception:
                pass

            on_playback_event(room_id, "started", {"track_id": first.id})
            return first.id
        finally:
            db.close()


def next_track(room_id: int) -> Optional[int]:
    """
    Переключить на следующий трек в очереди.

    Если следующего нет → now_playing_track_id = NULL (стоп).

    Returns:
        ID нового трека, либо None (очередь закончилась).
    """
    lock = _get_room_lock(room_id)
    with lock:
        db = SessionLocal()
        try:
            room = db.query(Room).filter(Room.id == room_id).with_for_update().first()
            if not room:
                return None

            current_id = room.now_playing_track_id

            if current_id is None:
                return start_playback(room_id)

            current = db.query(RoomTrack).filter(RoomTrack.id == current_id).first()
            if not current:
                room.now_playing_track_id = None
                db.commit()
                return start_playback(room_id)

            # Find next candidate using deterministic selector (queue_state + ready asset)
            if current.order is not None:
                next_row = (
                    db.query(RoomTrack)
                    .join(Track, and_(Track.source == RoomTrack.source, Track.source_track_id == RoomTrack.source_track_id))
                    .join(TrackAsset, TrackAsset.track_id == Track.id)
                    .filter(
                        RoomTrack.room_id == room_id,
                        RoomTrack.order > current.order,
                        RoomTrack.queue_state.in_(['ready', 'waiting_download']),
                        TrackAsset.status == 'ready',
                    )
                    .order_by(RoomTrack.order)
                    .first()
                )
            else:
                next_row = (
                    db.query(RoomTrack)
                    .join(Track, and_(Track.source == RoomTrack.source, Track.source_track_id == RoomTrack.source_track_id))
                    .join(TrackAsset, TrackAsset.track_id == Track.id)
                    .filter(
                        RoomTrack.room_id == room_id,
                        RoomTrack.id > current.id,
                        RoomTrack.queue_state.in_(['ready', 'waiting_download']),
                        TrackAsset.status == 'ready',
                    )
                    .order_by(RoomTrack.id)
                    .first()
                )

            # Loop mode: if nothing found, consider loop policy
            if not next_row and room.queue_mode == 'loop':
                next_row = (
                    db.query(RoomTrack)
                    .join(Track, and_(Track.source == RoomTrack.source, Track.source_track_id == RoomTrack.source_track_id))
                    .join(TrackAsset, TrackAsset.track_id == Track.id)
                    .filter(
                        RoomTrack.room_id == room_id,
                        RoomTrack.queue_state.in_(['ready', 'waiting_download']),
                        TrackAsset.status == 'ready',
                    )
                    .order_by(RoomTrack.order.nullsfirst(), RoomTrack.id)
                    .first()
                )

            if next_row:
                # mark previous as played
                try:
                    if current:
                        update_queue_state(current.id, 'played')
                except Exception:
                    pass

                room.now_playing_track_id = next_row.id
                room.is_playing = True
                room.playback_started_at = datetime.utcnow()
                try:
                    update_queue_state(next_row.id, 'playing')
                except Exception:
                    pass

                expected_end = None
                try:
                    expected_end = datetime.utcnow() + timedelta(seconds=int(next_row.duration or 0))
                except Exception:
                    expected_end = None

                try:
                    update_playback_session(room_id, 'playing', current_queue_item_id=next_row.id, expected_end_at=expected_end)
                except Exception:
                    pass

                on_playback_event(room_id, "next", {"track_id": next_row.id})
                return next_row.id
            else:
                room.now_playing_track_id = None
                db.commit()
                on_playback_event(room_id, "ended", {})
                return None

        finally:
            db.close()


def advance_playback(room_id: int) -> Optional[int]:
    """
    Атомарный advance — то же что next_track, но с явным именем.

    Существует для семантической ясности: advance = переход к следующему треку.
    Используй этот метод когда нужно продвинуть воспроизведение вперёд.
    """
    return next_track(room_id)


def set_now_playing(room_id: int, track_id: int) -> bool:
    """
    Установить now_playing_track_id напрямую.

    ВАЖНО: используй только для:
    - admin skip
    - resync
    - recovery after crash

    Returns:
        True если трек найден и записан, False если нет.
    """
    lock = _get_room_lock(room_id)
    with lock:
        db = SessionLocal()
        try:
            room = db.query(Room).filter(Room.id == room_id).with_for_update().first()
            if not room:
                return False

            track = db.query(RoomTrack).filter(
                RoomTrack.id == track_id,
                RoomTrack.room_id == room_id,
            ).first()
            if not track:
                return False

            prev_id = room.now_playing_track_id
            room.now_playing_track_id = track_id
            room.is_playing = True
            room.playback_started_at = datetime.utcnow()
            db.commit()

            on_playback_event(room_id, "set", {
                "track_id": track_id,
                "prev_track_id": prev_id,
            })
            return True
        finally:
            db.close()


def stop_playback(room_id: int) -> bool:
    """
    Остановить воспроизведение — сбросить now_playing_track_id в NULL.

    Returns:
        True если комната найдена, False если нет.
    """
    lock = _get_room_lock(room_id)
    with lock:
        db = SessionLocal()
        try:
            room = db.query(Room).filter(Room.id == room_id).with_for_update().first()
            if not room:
                return False

            prev_id = room.now_playing_track_id
            room.now_playing_track_id = None
            db.commit()

            on_playback_event(room_id, "stopped", {
                "prev_track_id": prev_id,
            })
            return True
        finally:
            db.close()


def get_now_playing(room_id: int) -> Optional[RoomTrack]:
    """
    Вернуть текущий RoomTrack или None.

    Read-only — не меняет состояние комнаты.
    """
    db = SessionLocal()
    try:
        # Prefer PlaybackSession as canonical source of truth
        sess = db.query(PlaybackSession).filter(PlaybackSession.room_id == room_id).first()
        if sess and sess.current_queue_item_id:
            rt = db.query(RoomTrack).filter(RoomTrack.id == sess.current_queue_item_id).first()
            if rt:
                return rt

        # Fallback: legacy room.now_playing_track_id
        room = db.query(Room).filter(Room.id == room_id).first()
        if not room or not room.now_playing_track_id:
            return None
        return (
            db.query(RoomTrack)
            .filter(RoomTrack.id == room.now_playing_track_id)
            .first()
        )
    finally:
        db.close()


def ensure_playback_consistency(room_id: int) -> Optional[int]:
    """
    Проверить что now_playing_track_id реально указывает на трек в очереди.

    Если now_playing_track_id:
    - указывает на несуществующий трек   → попробовать advance (следующий трек)
    - указывает на трек не из этой комнаты → попробовать advance
    - всё ок                             → вернуть текущий track_id

    Автоматический recovery после крашей / рассинхрона.

    Returns:
        ID текущего валидного трека, None если очередь пуста.
    """
    lock = _get_room_lock(room_id)
    with lock:
        db = SessionLocal()
        try:
            room = db.query(Room).filter(Room.id == room_id).first()
            if not room:
                return None

            if room.now_playing_track_id is None:
                return None

            track = db.query(RoomTrack).filter(
                RoomTrack.id == room.now_playing_track_id,
                RoomTrack.room_id == room_id,
            ).first()

            if track is not None:
                # If now_playing points to an item whose asset is failed, mark failed and advance
                try:
                    t = db.query(Track).filter(
                        Track.source == track.source,
                        Track.source_track_id == track.source_track_id,
                    ).first()
                    if t:
                        asset = db.query(TrackAsset).filter(TrackAsset.track_id == t.id).order_by(TrackAsset.updated_at.desc()).first()
                        if asset and asset.status == 'failed':
                            try:
                                update_queue_state(track.id, 'failed')
                            except Exception:
                                pass
                            return next_track(room_id)
                except Exception:
                    pass
                return track.id

            # now_playing_track_id указывает на битый трек — пробуем advance
            # вызываем next_track который сам возьмёт lock
            return next_track(room_id)
        finally:
            db.close()


def reconcile_queue(room_id: int) -> None:
    """
    Reconcile queue items: if a queue item references a Track whose latest
    TrackAsset.status == 'failed', mark the queue_item as 'failed' and emit
    a playback event so the loop can advance.
    """
    lock = _get_room_lock(room_id)
    with lock:
        db = SessionLocal()
        try:
            from app.database.models import TrackAsset
            rows = (
                db.query(RoomTrack)
                .filter(RoomTrack.room_id == room_id)
                .filter(RoomTrack.queue_state.in_(['ready', 'waiting_download', 'playing']))
                .all()
            )
            for r in rows:
                try:
                    t = db.query(Track).filter(Track.source == r.source, Track.source_track_id == r.source_track_id).first()
                    if not t:
                        continue
                    a = db.query(TrackAsset).filter(TrackAsset.track_id == t.id).order_by(TrackAsset.updated_at.desc()).first()
                    if a and a.status == 'failed':
                        try:
                            update_queue_state(r.id, 'failed')
                        except Exception:
                            pass
                        on_playback_event(room_id, 'queue_item_failed', {'track_id': r.id, 'asset_id': a.id})
                except Exception:
                    db.rollback()
                    continue
        finally:
            db.close()


def playback_tick(room_id: int, recovery_timeout_seconds: int = 10, max_retries: int = 3) -> None:
    """
    Deterministic playback tick executed by the playback loop.

    ALL work is done within a SINGLE lock + DB session to prevent deadlocks.
    Does NOT call start_playback / advance_playback / next_track / update_* —
    those open their own sessions and would cause nested-lock + nested-DB issues.

    Rules (state-machine driven):
    - If no PlaybackSession and queue non-empty -> inline start (creates session)
    - If session.playing: verify asset.status
        - if asset.status == 'failed' -> mark queue_item failed, set session to 'failed', advance
        - if expected_end_at passed -> mark played and advance
    - If session.stalled -> if retry_count < max_retries -> set recovering, else failed

    This function is idempotent and uses a single DB transaction.
    """
    lock = _get_room_lock(room_id)
    with lock:
        db = SessionLocal()
        try:
            room = db.query(Room).filter(Room.id == room_id).with_for_update().first()
            if not room:
                return

            # Inline queue-empty check (avoid extra session from is_queue_empty)
            queue_count = db.query(RoomTrack).filter(RoomTrack.room_id == room_id).count()
            if queue_count == 0:
                return

            sess = db.query(PlaybackSession).filter(PlaybackSession.room_id == room_id).with_for_update().first()

            # No session -> try to start playback INLINE
            if not sess:
                first = (
                    db.query(RoomTrack)
                    .join(Track, and_(Track.source == RoomTrack.source, Track.source_track_id == RoomTrack.source_track_id))
                    .join(TrackAsset, TrackAsset.track_id == Track.id)
                    .filter(
                        RoomTrack.room_id == room_id,
                        RoomTrack.queue_state.in_(['ready', 'waiting_download']),
                        TrackAsset.status == 'ready',
                    )
                    .order_by(RoomTrack.order.nullsfirst(), RoomTrack.id)
                    .first()
                )
                if not first:
                    return

                room.now_playing_track_id = first.id
                room.is_playing = True
                room.playback_started_at = datetime.utcnow()
                first.queue_state = 'playing'

                expected_end = None
                try:
                    expected_end = datetime.utcnow() + timedelta(seconds=int(first.duration or 0))
                except Exception:
                    pass

                sess = PlaybackSession(
                    room_id=room_id,
                    current_queue_item_id=first.id,
                    playback_state='playing',
                    expected_end_at=expected_end,
                    generation=1,
                )
                db.add(sess)
                db.commit()

                on_playback_event(room_id, "started", {"track_id": first.id})
                return

            # If playing, validate asset and expected end
            if sess.playback_state == 'playing' and sess.current_queue_item_id:
                rt = db.query(RoomTrack).filter(RoomTrack.id == sess.current_queue_item_id).first()
                if not rt:
                    _inner_advance(db, room, room_id, sess)
                    return

                # fetch associated TrackAsset
                t = db.query(Track).filter(Track.source == rt.source, Track.source_track_id == rt.source_track_id).first()
                asset = None
                if t:
                    asset = db.query(TrackAsset).filter(TrackAsset.track_id == t.id).order_by(TrackAsset.updated_at.desc()).first()

                if asset and asset.status == 'failed':
                    rt.queue_state = 'failed'
                    sess.playback_state = 'failed'
                    db.commit()
                    on_playback_event(room_id, 'queue_item_failed', {'track_id': rt.id, 'asset_id': asset.id})
                    _inner_advance(db, room, room_id, sess)
                    return

                # Expected end handling
                if sess.expected_end_at:
                    try:
                        now = datetime.utcnow()
                        if now >= sess.expected_end_at:
                            rt.queue_state = 'played'
                            sess.playback_state = 'played'
                            db.commit()
                            _inner_advance(db, room, room_id, sess)
                            return
                    except Exception:
                        pass

            # If stalled -> attempt recovery policies
            if sess.playback_state == 'stalled':
                if (sess.retry_count or 0) < max_retries:
                    # Use same session — no nested DB, no nested lock
                    cur_state = sess.playback_state
                    if cur_state in _ALLOWED_TRANSITIONS.get(sess.playback_state, []):
                        pass  # transition allowed

                    # Enforce transition: stalled -> recovering
                    if cur_state == 'stalled':
                        sess.playback_state = 'recovering'
                        sess.retry_count = (sess.retry_count or 0) + 1
                        sess.updated_at = datetime.utcnow()
                        sess.generation = (sess.generation or 0) + 1
                        db.commit()
                        on_playback_event(room_id, 'recovering', {'generation': sess.generation})
                    return
                else:
                    sess.playback_state = 'failed'
                    if sess.current_queue_item_id:
                        try:
                            cur = db.query(RoomTrack).filter(RoomTrack.id == sess.current_queue_item_id).first()
                            if cur:
                                cur.queue_state = 'failed'
                        except Exception:
                            pass
                    db.commit()
                    on_playback_event(room_id, 'queue_item_failed', {'track_id': sess.current_queue_item_id})
                    _inner_advance(db, room, room_id, sess)
                    return

        finally:
            db.close()


def _inner_advance(db, room, room_id: int, sess: PlaybackSession) -> None:
    """
    Inline advance within the caller's lock + session.

    CRITICAL: Does NOT acquire any lock and does NOT open a new DB session.
    Must only be called from inside playback_tick which already holds
    _get_room_lock(room_id) and owns the `db` session.

    Logic:
    - Mark current queue item as played/failed/stopped
    - Find next ready track in queue
    - Update room + PlaybackSession atomically
    - Emit appropriate playback event
    """
    current_item_id = sess.current_queue_item_id

    # Mark current queue item with the session's terminal state
    if current_item_id:
        try:
            rt = db.query(RoomTrack).filter(RoomTrack.id == current_item_id).first()
            if rt and rt.queue_state not in ('played', 'failed'):
                rt.queue_state = sess.playback_state
        except Exception:
            pass

    # Find next ready track in queue (same deterministic selector as start_playback)
    first = (
        db.query(RoomTrack)
        .join(Track, and_(Track.source == RoomTrack.source, Track.source_track_id == RoomTrack.source_track_id))
        .join(TrackAsset, TrackAsset.track_id == Track.id)
        .filter(
            RoomTrack.room_id == room_id,
            RoomTrack.queue_state.in_(['ready', 'waiting_download']),
            TrackAsset.status == 'ready',
        )
        .order_by(RoomTrack.order.nullsfirst(), RoomTrack.id)
        .first()
    )

    if first:
        room.now_playing_track_id = first.id
        room.is_playing = True
        room.playback_started_at = datetime.utcnow()
        first.queue_state = 'playing'

        expected_end = None
        try:
            expected_end = datetime.utcnow() + timedelta(seconds=int(first.duration or 0))
        except Exception:
            pass

        sess.current_queue_item_id = first.id
        sess.playback_state = 'playing'
        sess.expected_end_at = expected_end
        sess.generation = (sess.generation or 0) + 1
        sess.updated_at = datetime.utcnow()
        db.commit()

        on_playback_event(room_id, "next", {"track_id": first.id})
    else:
        # Queue exhausted
        room.now_playing_track_id = None
        room.is_playing = False
        sess.playback_state = 'stopped'
        sess.generation = (sess.generation or 0) + 1
        sess.updated_at = datetime.utcnow()
        db.commit()
        on_playback_event(room_id, "ended", {})


# ──────────────────────────────────────────────────────────────────────────────
#  Queue helpers (read-only, не меняют state)
# ──────────────────────────────────────────────────────────────────────────────

def get_queue(room_id: int) -> List[RoomTrack]:
    """
    Вернуть список всех треков очереди комнаты, отсортированных по order.

    Returns:
        Список RoomTrack объектов.
    """
    db = SessionLocal()
    try:
        return (
            db.query(RoomTrack)
            .filter(RoomTrack.room_id == room_id)
            .order_by(RoomTrack.order.nullsfirst(), RoomTrack.id)
            .all()
        )
    finally:
        db.close()


def is_queue_empty(room_id: int) -> bool:
    """True если в комнате нет треков в очереди."""
    db = SessionLocal()
    try:
        return (
            db.query(RoomTrack)
            .filter(RoomTrack.room_id == room_id)
            .count()
        ) == 0
    finally:
        db.close()