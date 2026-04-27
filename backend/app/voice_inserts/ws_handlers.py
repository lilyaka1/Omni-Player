"""
WebSocket handlers для voice inserts.
Добавляются в router.py в основной WS цикл.
"""
import logging
from fastapi import WebSocket
from sqlalchemy import select

from app.database.session import SessionLocal
from app.database.models import Room
from app.voice_inserts.model import VoiceInsert
from app.voice_inserts.queue import create_insert, cancel_insert, clear_room_inserts

log = logging.getLogger(__name__)


async def handle_insert_message(
    websocket: WebSocket,
    room_id: int,
    user_id: int,
    user_role: str,
    data: dict,
) -> None:
    """
    Dispatcher для insert-* сообщений.
    Вызывается из router.py после основных msg_type проверок.
    """
    msg_type = data.get("type", "")
    if not msg_type.startswith("insert_"):
        return

    # ── insert_create ────────────────────────────────────────────────────
    if msg_type == "insert_create":
        text = data.get("text", "").strip()
        voice_id = data.get("voice_id", "en_US-libritts-high")

        # Валидация
        if not text:
            await websocket.send_json({"type": "error", "msg": "Empty text"})
            return
        if len(text) > 500:
            await websocket.send_json({"type": "error", "msg": "Text too long (max 500 chars)"})
            return
        if len(text) < 2:
            await websocket.send_json({"type": "error", "msg": "Text too short"})
            return

        # Проверка роли
        if user_role not in ("admin", "moderator"):
            await websocket.send_json({"type": "error", "msg": "Forbidden"})
            return

        # Проверка что комната существует и активна
        db = SessionLocal()
        try:
            room = db.get(Room, room_id)
            if not room or not room.is_active:
                await websocket.send_json({"type": "error", "msg": "Room not found or inactive"})
                return

            insert = await create_insert(
                room_id=room_id,
                admin_id=user_id,
                text=text,
                voice_id=voice_id,
            )

            await websocket.send_json({
                "type": "insert_created",
                "insert": {
                    "id": insert.id,
                    "status": insert.status,
                    "text": insert.text,
                    "scheduled_at": insert.scheduled_at.isoformat(),
                },
            })
        except ValueError as e:
            await websocket.send_json({"type": "error", "msg": str(e)})
        finally:
            db.close()

    # ── insert_cancel ─────────────────────────────────────────────────────
    elif msg_type == "insert_cancel":
        insert_id = data.get("insert_id")

        if not insert_id:
            await websocket.send_json({"type": "error", "msg": "Missing insert_id"})
            return

        # Проверяем права: только автор или admin комнаты
        db = SessionLocal()
        try:
            insert = db.get(VoiceInsert, insert_id)
            if not insert or insert.room_id != room_id:
                await websocket.send_json({"type": "error", "msg": "Insert not found"})
                return

            # Проверяем роль
            if user_role not in ("admin", "moderator") and user_id != insert.admin_id:
                await websocket.send_json({"type": "error", "msg": "Forbidden"})
                return

            ok = await cancel_insert(insert_id, user_id)
            if ok:
                await websocket.send_json({"type": "insert_cancelled", "insert_id": insert_id})
            else:
                await websocket.send_json({"type": "error", "msg": "Cannot cancel this insert"})
        finally:
            db.close()

    # ── insert_list (для синхронизации при переподключении) ──────────────
    elif msg_type == "insert_list":
        db = SessionLocal()
        try:
            inserts = db.execute(
                select(VoiceInsert).where(
                    VoiceInsert.room_id == room_id,
                    VoiceInsert.status.in_(["pending", "generating", "ready"]),
                    VoiceInsert.is_auto == False,
                ).order_by(VoiceInsert.scheduled_at)
            ).scalars().all()

            await websocket.send_json({
                "type": "insert_list",
                "inserts": [
                    {
                        "id": i.id,
                        "text": i.text,
                        "status": i.status,
                        "scheduled_at": i.scheduled_at.isoformat(),
                        "audio_url": f"/tts/{i.content_hash}.mp3" if i.audio_path else None,
                        "duration_sec": i.duration_sec,
                    }
                    for i in inserts
                ],
            })
        finally:
            db.close()

    # ── insert_clear (очистка активных вставок комнаты) ───────────────────
    elif msg_type == "insert_clear":
        if user_role not in ("admin", "moderator"):
            await websocket.send_json({"type": "error", "msg": "Forbidden"})
            return

        cleared = await clear_room_inserts(room_id)
        await websocket.send_json({"type": "insert_clear_done", "count": cleared})
