from typing import List, Optional

from sqlalchemy import desc
from sqlalchemy.orm import Session

from app.database.models import Room, User, UserRoom

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
            is_playing=False,
            queue_mode="normal"
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
