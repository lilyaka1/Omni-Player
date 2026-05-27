from typing import List, Optional

from sqlalchemy import desc
from sqlalchemy.orm import Session

from app.database.models import Room, User, UserRoom


def _import_playback():
    """
    Lazy import playback modules.

    Делаем отдельно чтобы при старте приложения
    (когда playback ещё не нужен) не было import error.
    """
    from app.playback.controller import get_now_playing, is_queue_empty
    from app.playback.loop import playback_loop
    return playback_loop, get_now_playing, is_queue_empty

class RoomService:
    def __init__(self, db: Session):
        self.db = db
    
    def create_room(self, name: str, owner: User, description: Optional[str] = None,
                    room_type: Optional[str] = None, max_users: int = 50,
                    cover_url: Optional[str] = None, genre: Optional[str] = None) -> Room:
        """Create a new room."""
        room = Room(
            name=name,
            description=description,
            creator_id=owner.id,
            is_active=True,
            cover_url=cover_url,
            genre=genre,
            room_type=room_type or "public",
            max_users=max_users,
        )
        self.db.add(room)
        self.db.commit()
        self.db.refresh(room)
        return room
    
    def get_room(self, room_id: int) -> Optional[Room]:
        """Get a room by ID."""
        return self.db.query(Room).filter(Room.id == room_id).first()
    
    def get_rooms(self, skip: int = 0, limit: int = 20, public_only: bool = True) -> List[Room]:
        """Get list of rooms."""
        query = self.db.query(Room)
        if public_only:
            query = query.filter(Room.is_active == True)
        return query.order_by(desc(Room.created_at)).offset(skip).limit(limit).all()
    
    def update_room(self, room_id: int, **kwargs) -> Optional[Room]:
        """Update a room."""
        room = self.get_room(room_id)
        if not room:
            return None
        
        for key, value in kwargs.items():
            if hasattr(room, key) and value is not None:
                setattr(room, key, value)
        
        self.db.commit()
        self.db.refresh(room)
        return room
    
    def delete_room(self, room_id: int) -> bool:
        """Delete a room."""
        room = self.get_room(room_id)
        if not room:
            return False
        
        self.db.delete(room)
        self.db.commit()
        return True
    
    def join_room(self, room_id: int, user: User) -> bool:
        """Add user to room."""
        room = self.get_room(room_id)
        if not room or not room.is_active:
            return False
        
        # Check if user is already in room
        existing = self.db.query(UserRoom).filter(
            UserRoom.room_id == room_id,
            UserRoom.user_id == user.id,
        ).first()
        
        if existing:
            if existing.is_banned:
                existing.is_banned = False
                self.db.commit()
            return True
        
        room_user = UserRoom(
            room_id=room_id,
            user_id=user.id,
            is_banned=False
        )
        self.db.add(room_user)
        self.db.commit()
        return True
    
    def leave_room(self, room_id: int, user: User) -> bool:
        """Remove user from room."""
        room = self.get_room(room_id)
        if not room:
            return False
        
        room_user = self.db.query(UserRoom).filter(
            UserRoom.room_id == room_id,
            UserRoom.user_id == user.id,
            UserRoom.is_banned == False
        ).first()
        
        if not room_user:
            return False
        
        room_user.is_banned = True
        self.db.commit()
        return True
    
    def get_room_users(self, room_id: int) -> List[User]:
        """Get all active users in a room."""
        return (
            self.db.query(User)
            .join(UserRoom, UserRoom.user_id == User.id)
            .filter(
                UserRoom.room_id == room_id,
                UserRoom.is_banned == False,
            )
            .all()
        )
    
    def get_user_rooms(self, user_id: int) -> List[Room]:
        """Get all rooms a user is in."""
        return (
            self.db.query(Room)
            .join(UserRoom, UserRoom.room_id == Room.id)
            .filter(
                UserRoom.user_id == user_id,
                UserRoom.is_banned == False,
            )
            .order_by(desc(Room.created_at))
            .all()
        )

    # ──────────────────────────────────────────────────────────────────────────
    #  Playback Orchestration (NEW — uses playback engine)
    # ──────────────────────────────────────────────────────────────────────────

    def join_room_with_playback(self, room_id: int, user: User) -> bool:
        """
        Присоединить пользователя + авто-запуск playback.

        При первом user join:
        - если очередь не пустая → register_room в playback loop

        При повторном join — только добавляет пользователя,
        не перезапускает loop (idempotent).

        Returns:
            True если успешно.
        """
        if not self.join_room(room_id, user):
            return False

        # Проверяем: это первый юзер в комнате?
        user_count = self._get_active_user_count(room_id)
        if user_count == 1:
            # Первый юзер — запускаем playback loop
            self._ensure_playback_active(room_id)

        return True

    def leave_room_cleanup(self, room_id: int, user: User) -> bool:
        """
        Пользователь покинул комнату.

        НЕ останавливает playback сразу — loop работает дальше.
        При последнем user leave комната остаётся "живой"
        (loop продолжит играть, но is_active может поменяться).
        """
        return self.leave_room(room_id, user)

    def get_room_state(self, room_id: int) -> Optional[dict]:
        """
        Агрегированное состояние комнаты.

        Returns:
            dict с room_id, users, queue_size, now_playing, is_playing, is_active
            или None если комната не найдена.
        """
        room = self.get_room(room_id)
        if not room:
            return None

        _, get_now_playing, is_queue_empty = _import_playback()

        users = self.get_room_users(room_id)
        now_playing = get_now_playing(room_id)
        queue_empty = is_queue_empty(room_id)

        return {
            "room_id": room.id,
            "name": room.name,
            "users": [{"id": u.id, "username": u.username} for u in users],
            "user_count": len(users),
            "queue_empty": queue_empty,
            "now_playing_track_id": room.now_playing_track_id,
            "now_playing": {
                "id": now_playing.id,
                "title": now_playing.title,
                "artist": now_playing.artist,
            } if now_playing else None,
            "is_playing": room.now_playing_track_id is not None,
            "is_active": room.is_active,
        }

    # ──────────────────────────────────────────────────────────────────────────
    #  Internal helpers
    # ──────────────────────────────────────────────────────────────────────────

    def _get_active_user_count(self, room_id: int) -> int:
        """Количество активных (не забаненных) пользователей в комнате."""
        return (
            self.db.query(UserRoom)
            .filter(
                UserRoom.room_id == room_id,
                UserRoom.is_banned == False,
            )
            .count()
        )

    def _ensure_playback_active(self, room_id: int):
        """
        Запустить playback loop если комната "живая".

        Ничего не делает если:
        - комната не существует
        - очередь пустая
        - loop уже запущен
        """
        try:
            playback_loop, _, _ = _import_playback()
            playback_loop.register_room(room_id)
        except Exception:
            # Playback может быть недоступен на старте приложения —
            # это не критическая ошибка
            pass

    def delete_room_with_cleanup(self, room_id: int) -> bool:
        """
        Удалить комнату + остановить её playback loop.

        Returns:
            True если успешно.
        """
        # Сначала останавливаем loop
        try:
            playback_loop, _, _ = _import_playback()
            playback_loop.unregister_room(room_id)
        except Exception:
            pass

        return self.delete_room(room_id)
