from fastapi import APIRouter, Depends, HTTPException, status, Header
from sqlalchemy.orm import Session
from typing import List
from app.core.dependencies import get_db, get_current_user
from app.database.models import User, Room, UserRole
from app.domains.rooms.schemas import RoomResponse
from pydantic import BaseModel

def get_admin_user(current_user: User = Depends(get_current_user)) -> User:
    """Verify that the current user is an admin."""
    if not current_user:
        raise HTTPException(
            status_code=status.HTTP_401_UNAUTHORIZED,
            detail="Not authenticated"
        )
    if current_user.role != UserRole.ADMIN:
        raise HTTPException(
            status_code=status.HTTP_403_FORBIDDEN,
            detail="Admin access required"
        )
    return current_user

class UserAdminResponse(BaseModel):
    id: int
    email: str
    username: str
    role: str
    is_blocked: bool
    can_create_rooms: bool
    created_at: str
    
    class Config:
        from_attributes = True

router = APIRouter(
    prefix="/admin",
    tags=["admin"]
)

@router.get("/users", response_model=List[UserAdminResponse])
async def get_all_users(
    _: User = Depends(get_admin_user),
    db: Session = Depends(get_db)
):
    """Get all users (admin only)"""
    users = db.query(User).all()
    return users

@router.get("/rooms", response_model=List[RoomResponse])
async def get_all_rooms(
    _: User = Depends(get_admin_user),
    db: Session = Depends(get_db)
):
    rooms = db.query(Room).all()
    return rooms

@router.post("/users/{user_id}/block")
async def block_user(
    user_id: int,
    _: User = Depends(get_admin_user),
    db: Session = Depends(get_db)
):
    user = db.query(User).filter(User.id == user_id).first()
    if not user:
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND,
            detail="User not found"
        )
    
    user.is_blocked = True
    db.commit()
    return {"message": f"User {user.username} has been blocked"}

@router.post("/users/{user_id}/unblock")
async def unblock_user(
    user_id: int,
    _: User = Depends(get_admin_user),
    db: Session = Depends(get_db)
):
    user = db.query(User).filter(User.id == user_id).first()
    if not user:
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND,
            detail="User not found"
        )
    
    user.is_blocked = False
    db.commit()
    return {"message": f"User {user.username} has been unblocked"}

@router.post("/users/{user_id}/grant-create-rooms")
async def grant_create_rooms(
    user_id: int,
    _: User = Depends(get_admin_user),
    db: Session = Depends(get_db)
):
    user = db.query(User).filter(User.id == user_id).first()
    if not user:
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND,
            detail="User not found"
        )
    
    user.can_create_rooms = True
    db.commit()
    return {"message": f"User {user.username} can now create rooms"}

@router.post("/users/{user_id}/revoke-create-rooms")
async def revoke_create_rooms(
    user_id: int,
    _: User = Depends(get_admin_user),
    db: Session = Depends(get_db)
):
    user = db.query(User).filter(User.id == user_id).first()
    if not user:
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND,
            detail="User not found"
        )
    
    user.can_create_rooms = False
    db.commit()
    return {"message": f"User {user.username} can no longer create rooms"}
