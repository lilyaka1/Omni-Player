"""
Insert queue: создание, pre-generation, timeout checker.
Интегрируется с room_manager для pre-generation на основе queue depth.
"""
import asyncio
import logging
from datetime import datetime, timedelta
from typing import Optional

from sqlalchemy import select

from app.database.session import SessionLocal
from app.database.models import Room
from app.voice_inserts.model import VoiceInsert
from app.voice_inserts.tts import (
    generate_speech,
    TTSResult,
    COMMON_PHRASES,
    _content_hash,
    TTS_AUDIO_DIR,
)

log = logging.getLogger(__name__)

# ── Content hash для кэширования ─────────────────────────────────────────────
def calc_hash(text: str, voice_id: str = "en_US-libritts-high") -> str:
    return _content_hash(text, voice_id)


# ── Room-level insert limits ─────────────────────────────────────────────────
ADMIN_INSERT_LIMIT_PER_MIN = 5


# ── Main service ──────────────────────────────────────────────────────────────
async def create_insert(
    room_id: int,
    admin_id: int,
    text: str,
    voice_id: str = "en_US-libritts-high",
    play_after_track_id: Optional[int] = None,
) -> VoiceInsert:
    """
    Создаёт VoiceInsert в БД и запускает генерацию.
    Не blocking — генерация в asyncio.create_task.
    """
    text = text.strip()
    if not text or len(text) > 500:
        raise ValueError("Text must be 1-500 characters")

    # Rate limit
    _check_rate_limit(admin_id, room_id)

    scheduled_at = datetime.utcnow() + timedelta(seconds=3)
    content_hash = calc_hash(text, voice_id)

    db = SessionLocal()
    try:
        insert = VoiceInsert(
            room_id=room_id,
            admin_id=admin_id,
            text=text,
            voice_id=voice_id,
            status="pending",
            scheduled_at=scheduled_at,
            content_hash=content_hash,
            play_after_track_id=play_after_track_id,
        )
        db.add(insert)
        db.commit()
        db.refresh(insert)
    finally:
        db.close()

    # Запускаем генерацию — fire and forget
    asyncio.create_task(_generate_insert_task(insert.id))

    return insert


def _check_rate_limit(admin_id: int, room_id: int) -> None:
    """Простой in-memory rate limit. Сбрасывается каждую минуту."""
    key = (admin_id, room_id)
    now = datetime.utcnow()

    if not hasattr(_check_rate_limit, "_counts"):
        _check_rate_limit._counts = {}

    last_reset, count = _check_rate_limit._counts.get(key, (now, 0))

    if (now - last_reset) > timedelta(minutes=1):
        _check_rate_limit._counts[key] = (now, 1)
        return

    if count >= ADMIN_INSERT_LIMIT_PER_MIN:
        raise ValueError(f"Rate limit: max {ADMIN_INSERT_LIMIT_PER_MIN} inserts/min")

    _check_rate_limit._counts[key] = (last_reset, count + 1)


# ── Background generation task ───────────────────────────────────────────────
async def _generate_insert_task(insert_id: int) -> None:
    """Генерирует один insert. Вызывается через create_task."""
    db = SessionLocal()
    try:
        insert = db.get(VoiceInsert, insert_id)
        if insert is None:
            return
        if insert.status != "pending":
            return
        # Проверяем room alive
        room = db.get(Room, insert.room_id)
        if room is None:
            insert.status = "skipped"
            insert.error_message = "Room deleted"
            db.commit()
            return
        if not room.is_active:
            insert.status = "skipped"
            insert.error_message = "Room inactive"
            db.commit()
            return

        insert.status = "generating"
        db.commit()

        result = await generate_speech(insert.text, insert.voice_id)

        if result.success:
            insert.status = "ready"
            insert.audio_path = result.audio_path
            insert.duration_sec = result.duration_sec
            db.commit()
            log.info(f"Insert ready: {insert.id} ({insert.text[:40]})")

            # Broadcast: отправляем всем в комнате
            await _broadcast_insert_ready(insert)
        else:
            insert.status = "failed"
            insert.error_message = result.error
            db.commit()
            log.warning(f"Insert failed: {insert.id} — {result.error}")

            # Broadcast failed только админу
            await _broadcast_insert_failed(insert)

    except Exception as e:
        log.exception(f"Insert generation error: {insert_id}")
        try:
            insert = db.get(VoiceInsert, insert_id)
            if insert:
                insert.status = "failed"
                insert.error_message = str(e)
                db.commit()
        except Exception:
            pass
    finally:
        db.close()


# ── Broadcast helpers (импортируем здесь, чтобы избежать circular import) ──
async def _broadcast_insert_ready(insert: VoiceInsert) -> None:
    try:
        from app.websocket.manager import manager
        import json

        payload = {
            "type": "insert_ready",
            "insert": {
                "id": insert.id,
                "text": insert.text,
                "voice_id": insert.voice_id,
                "status": insert.status,
                "scheduled_at": insert.scheduled_at.isoformat(),
                "audio_url": f"/tts/{insert.content_hash}.mp3",
                "duration_sec": insert.duration_sec,
            },
        }
        await manager.broadcast(insert.room_id, json.dumps(payload))
    except Exception as e:
        log.warning(f"Broadcast insert_ready failed: {e}")


async def _broadcast_insert_failed(insert: VoiceInsert) -> None:
    try:
        from app.websocket.manager import manager
        import json

        # Отправляем только админу (он в active_connections с ролью)
        payload = json.dumps({
            "type": "insert_failed",
            "insert_id": insert.id,
            "error": insert.error_message,
            "text": insert.text,
        })

        # Найти WS админа
        connections = manager.active_connections.get(insert.room_id, [])
        for ws, user_id, role in connections:
            if role == "admin" and user_id == insert.admin_id:
                try:
                    await ws.send_text(payload)
                except Exception:
                    pass
                break
    except Exception as e:
        log.warning(f"Broadcast insert_failed failed: {e}")


# ── Timeout checker (background task) ─────────────────────────────────────────
async def insert_timeout_checker() -> None:
    """
    Каждые 5 секунд: scheduled_at прошло + 5s, а insert still pending → timeout.
    """
    while True:
        await asyncio.sleep(5)
        try:
            db = SessionLocal()
            try:
                now = datetime.utcnow()
                deadline = now - timedelta(seconds=5)

                overdue = db.execute(
                    select(VoiceInsert).where(
                        VoiceInsert.scheduled_at < deadline,
                        VoiceInsert.status.in_(["pending", "generating"]),
                    )
                ).scalars().all()

                for insert in overdue:
                    insert.status = "timeout"
                    db.commit()
                    log.warning(f"Insert timeout: {insert.id}")

                    # Broadcast timeout → все клиенты показывают текстовый bubble
                    try:
                        from app.websocket.manager import manager
                        import json
                        payload = json.dumps({
                            "type": "insert_timeout",
                            "insert": {
                                "id": insert.id,
                                "text": insert.text,
                            },
                        })
                        await manager.broadcast(insert.room_id, payload)
                    except Exception as e:
                        log.warning(f"Broadcast insert_timeout failed: {e}")
            finally:
                db.close()
        except Exception as e:
            log.exception(f"insert_timeout_checker error: {e}")


# ── Pre-generation on room start ─────────────────────────────────────────────
async def prewarm_room(room_id: int, admin_id: Optional[int] = None) -> int:
    """
    При старте комнаты генерируем COMMON_PHRASES в фоне.
    Эти inserts имеют scheduled_at +24h — не играют автоматически,
    но кэшируются на диске.
    """
    generated = 0

    # Если admin_id не передан, прогреваем только файловый кэш без записей в БД.
    if admin_id is None:
        for phrase in COMMON_PHRASES:
            h = calc_hash(phrase)
            path = TTS_AUDIO_DIR / f"{h}.mp3"
            if path.exists():
                continue
            asyncio.create_task(_pregenerate_phrase(phrase))
            generated += 1
        log.info(f"Prewarmed cache for room {room_id}: {generated} phrases")
        return generated

    db = SessionLocal()
    try:
        for phrase in COMMON_PHRASES:
            h = calc_hash(phrase)
            path = TTS_AUDIO_DIR / f"{h}.mp3"
            if path.exists():
                continue

            insert = VoiceInsert(
                room_id=room_id,
                admin_id=admin_id,
                text=phrase,
                voice_id="en_US-libritts-high",
                status="pending",
                scheduled_at=datetime.utcnow() + timedelta(hours=24),
                content_hash=h,
                is_auto=True,
            )
            db.add(insert)
            db.commit()
            asyncio.create_task(_generate_insert_task(insert.id))
            generated += 1
    finally:
        db.close()

    log.info(f"Prewarmed room {room_id} with {generated} common phrases")
    return generated


# ── Queue depth check (вызывается из room_manager при смене трека) ──────────
async def on_queue_change(room_id: int, queue_len: int) -> None:
    """
    Called when room queue changes.
    Triggers cache pre-generation if queue gets short (<= 5 tracks).
    """
    if queue_len <= 5:
        for phrase in COMMON_PHRASES:
            h = calc_hash(phrase)
            path = TTS_AUDIO_DIR / f"{h}.mp3"
            if path.exists():
                continue
            asyncio.create_task(_pregenerate_phrase(phrase))


async def _pregenerate_phrase(phrase: str) -> None:
    result = await generate_speech(phrase)
    if result.success:
        log.info(f"Pre-generated: {phrase[:40]}")
    else:
        log.warning(f"Pre-gen failed: {phrase[:40]} — {result.error}")


# ── Cancel insert ───────────────────────────────────────────────────────────
async def cancel_insert(insert_id: int, user_id: int) -> bool:
    """Отмена pending insert. Только автор или admin комнаты."""
    db = SessionLocal()
    try:
        insert = db.get(VoiceInsert, insert_id)
        if not insert:
            return False
        if insert.status not in ("pending", "generating"):
            return False
        insert.status = "cancelled"
        db.commit()

        try:
            from app.websocket.manager import manager
            import json
            payload = json.dumps({
                "type": "insert_cancelled",
                "insert_id": insert_id,
            })
            await manager.broadcast(insert.room_id, payload)
        except Exception:
            pass

        return True
    finally:
        db.close()


async def clear_room_inserts(room_id: int) -> int:
    """Очищает активные voice inserts в комнате (кроме auto)."""
    db = SessionLocal()
    try:
        inserts = db.execute(
            select(VoiceInsert).where(
                VoiceInsert.room_id == room_id,
                VoiceInsert.is_auto == False,
                VoiceInsert.status.in_(["pending", "generating", "ready"]),
            )
        ).scalars().all()

        if not inserts:
            return 0

        for insert in inserts:
            insert.status = "cancelled"
            if not insert.error_message:
                insert.error_message = "Cleared by admin"

        db.commit()

        try:
            from app.websocket.manager import manager
            import json
            payload = json.dumps({
                "type": "insert_cleared",
                "count": len(inserts),
            })
            await manager.broadcast(room_id, payload)
        except Exception:
            pass

        return len(inserts)
    finally:
        db.close()
