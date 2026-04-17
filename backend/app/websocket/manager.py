from fastapi import WebSocket, WebSocketDisconnect
from typing import List, Dict, Tuple
import json
from datetime import datetime
import time

class ConnectionManager:
    def __init__(self):
        self.active_connections: Dict[int, List[Tuple[WebSocket, int, str]]] = {}  # room_id -> [(ws, user_id, role), ...]
        self.room_states: Dict[int, Dict] = {}
        self.user_roles: Dict[Tuple[int, int], str] = {}  # (room_id, user_id) -> role
    
    async def connect(self, websocket: WebSocket, room_id: int, user_id: int = None, user_role: str = "user", skip_accept: bool = False):
        if not skip_accept:
            await websocket.accept()
        if room_id not in self.active_connections:
            self.active_connections[room_id] = []
            self.room_states[room_id] = {
                "current_track": None,
                "current_time": 0,
                "is_playing": False,
                "users": 0,
                "started_at": datetime.utcnow().isoformat(),
                "last_update_time": time.time(),
                "last_known_time": 0
            }
        
        self.active_connections[room_id].append((websocket, user_id, user_role))
        if user_id and user_role:
            self.user_roles[(room_id, user_id)] = user_role
        
        self.room_states[room_id]["users"] = len(self.active_connections[room_id])
        
        # Отправляем room_state только если НЕ skip_accept —
        # при skip_accept=True handle_connection сам пришлёт актуальный state из БД
        if not skip_accept:
            state_with_role = {**self.room_states[room_id], "user_role": user_role}
            print(f"📤 Отправляю room_state клиенту (роль: {user_role}): {state_with_role}")
            await websocket.send_json({
                "type": "room_state",
                "data": state_with_role
            })
    
    def disconnect(self, room_id: int, websocket: WebSocket):
        if room_id in self.active_connections:
            # Find and remove the connection tuple
            self.active_connections[room_id] = [
                conn for conn in self.active_connections[room_id] 
                if conn[0] != websocket
            ]
            self.room_states[room_id]["users"] = len(self.active_connections[room_id])
            
            # If no users left, clean up all room state
            if len(self.active_connections[room_id]) == 0:
                del self.active_connections[room_id]
                if room_id in self.room_states:
                    del self.room_states[room_id]
                keys = [k for k in self.user_roles if k[0] == room_id]
                for k in keys:
                    del self.user_roles[k]
    
    async def broadcast(self, room_id: int, message: str):
        if room_id in self.active_connections:
            for ws, user_id, role in self.active_connections[room_id]:
                try:
                    await ws.send_text(message)
                except:
                    pass
    
    def get_room_state(self, room_id: int):
        return self.room_states.get(room_id, None)
    
    def set_room_state(self, room_id: int, track: dict = None, is_playing: bool = None):
        if room_id in self.room_states:
            if track:
                self.room_states[room_id]["current_track"] = track
                self.room_states[room_id]["current_time"] = 0
                self.room_states[room_id]["last_known_time"] = 0
                self.room_states[room_id]["is_playing"] = True
                self.room_states[room_id]["last_update_time"] = time.time()
                self.room_states[room_id]["started_at"] = datetime.utcnow().isoformat()
            if is_playing is not None:
                self.room_states[room_id]["is_playing"] = is_playing
                self.room_states[room_id]["last_update_time"] = time.time()
            
            return self.room_states[room_id]
    

manager = ConnectionManager()
