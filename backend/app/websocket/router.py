"""
WebSocket router — единственный WS эндпоинт приложения.
"""
import json
import logging
from fastapi import APIRouter, WebSocket, WebSocketDisconnect, Query

from app.websocket.manager import manager
from app.websocket.handlers import (
    handle_connection,
    handle_chat,
    handle_track_change,
    handle_playback_control,
    handle_playback_ended,
)
from app.voice_inserts.ws_handlers import handle_insert_message

logger = logging.getLogger(__name__)

router = APIRouter(prefix="/ws", tags=["websocket"])


@router.websocket("/rooms/{room_id}")
async def websocket_endpoint(
    websocket: WebSocket,
    room_id: int,
    token: str = Query(None),
):
    # 1. Аутентификация и подключение
    result = await handle_connection(websocket, room_id, token)

    if result is None:
        return
    user, _room, user_role = result

    # 2. Основной цикл сообщений
    try:
        while True:
            data = await websocket.receive_json()
            msg_type = data.get("type")
            logger.info(f"WS [{room_id}] user={user.id} type={msg_type} data_keys={list(data.keys())}")

            if msg_type == "ping":
                continue
            elif msg_type == "chat":
                await handle_chat(room_id, user, data)
            elif msg_type == "track_change":
                logger.info(f"WS [{room_id}] track_change data={json.dumps(data, default=str)}")
                await handle_track_change(websocket, room_id, user, data)
            elif msg_type == "playback_control":
                logger.info(f"WS [{room_id}] playback_control data={json.dumps(data, default=str)}")
                await handle_playback_control(room_id, data)
            elif msg_type == "playback_ended":
                logger.info(f"WS [{room_id}] playback_ended data={json.dumps(data, default=str)}")
                await handle_playback_ended(room_id, data)
            elif msg_type == "reorder_queue":
                from app.websocket.handlers import handle_reorder_queue
                await handle_reorder_queue(room_id, data)
            elif isinstance(msg_type, str) and msg_type.startswith("insert_"):
                await handle_insert_message(websocket, room_id, user.id, user_role, data)

    except WebSocketDisconnect:
        manager.disconnect(room_id, websocket)
        room_state = manager.get_room_state(room_id)
        if room_state:
            await manager.broadcast_event(room_id, 'user_count', {"count": room_state["users"]})
