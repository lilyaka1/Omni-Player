"""
WebSocket router — единственный WS эндпоинт приложения.
"""
import json
from fastapi import APIRouter, WebSocket, WebSocketDisconnect, Query

from app.websocket.manager import manager
from app.websocket.handlers import (
    handle_connection,
    handle_chat,
    handle_track_change,
    handle_playback_control,
)

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

            if msg_type == "ping":
                continue
            elif msg_type == "chat":
                await handle_chat(room_id, user, data)
            elif msg_type == "track_change":
                await handle_track_change(websocket, room_id, user, data)
            elif msg_type == "playback_control":
                await handle_playback_control(room_id, data)

    except WebSocketDisconnect:
        manager.disconnect(room_id, websocket)
        room_state = manager.get_room_state(room_id)
        if room_state:
            await manager.broadcast(
                room_id,
                json.dumps({"type": "user_count", "count": room_state["users"]}),
            )
