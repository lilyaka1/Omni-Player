from typing import List
from fastapi import APIRouter, Depends, HTTPException, status, Query
from sqlalchemy.orm import Session
from app.core.dependencies import get_db, get_current_user
from app.database.models import User
from app.domains.rooms.service import RoomService
from app.domains.rooms.schemas import RoomCreate, RoomResponse, RoomUpdate, RoomDetailResponse, RoomUserResponse
from app.domains.auth.service import AuthService

router = APIRouter(prefix="/rooms", tags=["rooms"])

@router.get("/", response_model=List[RoomResponse])
def list_rooms(
    skip: int = Query(0, ge=0),
    limit: int = Query(20, ge=1, le=100),
    public_only: bool = True,
    db: Session = Depends(get_db)
):
    """Get list of all rooms."""
    room_service = RoomService(db)
    rooms = room_service.get_rooms(skip=skip, limit=limit, public_only=public_only)
    return rooms

@router.post("/", response_model=RoomResponse, status_code=status.HTTP_201_CREATED)
def create_room(
    room_data: RoomCreate,
    current_user: User = Depends(get_current_user),
    db: Session = Depends(get_db)
):
    """Create a new room."""
    if not current_user:
        raise HTTPException(
            status_code=status.HTTP_401_UNAUTHORIZED,
            detail="Not authenticated"
        )
    
    room_service = RoomService(db)
    room = room_service.create_room(
        name=room_data.name,
        owner=current_user,
        description=room_data.description,
        room_type=room_data.room_type,
        max_users=room_data.max_users
    )
    return room

@router.get("/{room_id}", response_model=RoomDetailResponse)
def get_room(room_id: int, db: Session = Depends(get_db)):
    """Get room details."""
    room_service = RoomService(db)
    room = room_service.get_room(room_id)
    if not room:
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND,
            detail="Room not found"
        )
    
    # Get room users
    room_users = room_service.get_room_users(room_id)
    users = []
    for ru in room_users:
        user = ru.user if hasattr(ru, 'user') else None
        if user:
            users.append(RoomUserResponse(
                id=user.id,
                username=user.username,
                display_name=user.display_name,
                avatar_url=user.avatar_url,
                role=user.role.value if hasattr(user.role, 'value') else str(user.role)
            ))
    
    return RoomDetailResponse(
        id=room.id,
        name=room.name,
        description=room.description,
        room_type=room.room_type.value if hasattr(room.room_type, 'value') else str(room.room_type),
        owner_id=room.owner_id,
        is_active=room.is_active,
        max_users=room.max_users,
        current_users=room.current_users,
        created_at=room.created_at,
        updated_at=room.updated_at,
        users=users
    )

@router.put("/{room_id}", response_model=RoomResponse)
def update_room(
    room_id: int,
    room_data: RoomUpdate,
    current_user: User = Depends(get_current_user),
    db: Session = Depends(get_db)
):
    """Update a room."""
    if not current_user:
        raise HTTPException(
            status_code=status.HTTP_401_UNAUTHORIZED,
            detail="Not authenticated"
        )
    
    room_service = RoomService(db)
    room = room_service.get_room(room_id)
    if not room:
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND,
            detail="Room not found"
        )
    
    if room.owner_id != current_user.id and current_user.role != "admin":
        raise HTTPException(
            status_code=status.HTTP_403_FORBIDDEN,
            detail="Not authorized to update this room"
        )
    
    updated_room = room_service.update_room(
        room_id,
        name=room_data.name,
        description=room_data.description,
        room_type=room_data.room_type,
        max_users=room_data.max_users,
        is_active=room_data.is_active
    )
    return updated_room

@router.delete("/{room_id}", status_code=status.HTTP_204_NO_CONTENT)
def delete_room(
    room_id: int,
    current_user: User = Depends(get_current_user),
    db: Session = Depends(get_db)
):
    """Delete a room."""
    if not current_user:
        raise HTTPException(
            status_code=status.HTTP_401_UNAUTHORIZED,
            detail="Not authenticated"
        )
    
    room_service = RoomService(db)
    room = room_service.get_room(room_id)
    if not room:
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND,
            detail="Room not found"
        )
    
    if room.owner_id != current_user.id and current_user.role != "admin":
        raise HTTPException(
            status_code=status.HTTP_403_FORBIDDEN,
            detail="Not authorized to delete this room"
        )
    
    room_service.delete_room(room_id)
    return None
