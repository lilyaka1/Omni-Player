from typing import List, Optional
from sqlalchemy.orm import Session
from sqlalchemy import desc
from app.database.models import Room, RoomType, User, RoomUser, RoomTrack

class RoomService:
    def __init__(self, db: Session):
        self.db = db
    
    def create_room(self, name: str, owner: User, description: Optional[str] = None,
                    room_type: RoomType = RoomType.PUBLIC, max_users: int = 50) -> Room:
        """Create a new room."""
        room = Room(
            name=name,
            description=description,
            room_type=room_type,
            owner_id=owner.id,
            max_users=max_users,
            is_active=True,
            current_users=0
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
            query = query.filter(Room.room_type == RoomType.PUBLIC)
        return query.order_by(desc(Room.current_users)).offset(skip).limit(limit).all()
    
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
        
        if room.current_users >= room.max_users:
            return False
        
        # Check if user is already in room
        existing = self.db.query(RoomUser).filter(
            RoomUser.room_id == room_id,
            RoomUser.user_id == user.id,
            RoomUser.is_active == True
        ).first()
        
        if existing:
            return True
        
        room_user = RoomUser(
            room_id=room_id,
            user_id=user.id,
            is_active=True
        )
        self.db.add(room_user)
        room.current_users += 1
        self.db.commit()
        return True
    
    def leave_room(self, room_id: int, user: User) -> bool:
        """Remove user from room."""
        room = self.get_room(room_id)
        if not room:
            return False
        
        room_user = self.db.query(RoomUser).filter(
            RoomUser.room_id == room_id,
            RoomUser.user_id == user.id,
            RoomUser.is_active == True
        ).first()
        
        if not room_user:
            return False
        
        room_user.is_active = False
        room.current_users = max(0, room.current_users - 1)
        self.db.commit()
        return True
    
    def get_room_users(self, room_id: int) -> List[RoomUser]:
        """Get all active users in a room."""
        return self.db.query(RoomUser).filter(
            RoomUser.room_id == room_id,
            RoomUser.is_active == True
        ).all()
    
    def get_user_rooms(self, user_id: int) -> List[Room]:
        """Get all rooms a user is in."""
        room_ids = self.db.query(RoomUser.room_id).filter(
            RoomUser.user_id == user_id,
            RoomUser.is_active == True
        ).subquery()
        
        return self.db.query(Room).filter(Room.id.in_(room_ids)).all()