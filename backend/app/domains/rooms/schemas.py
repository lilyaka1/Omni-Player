from pydantic import BaseModel, Field
from typing import Optional, List
from datetime import datetime

class RoomCreate(BaseModel):
    name: str = Field(..., min_length=1, max_length=100)
    description: Optional[str] = None
    room_type: str = "public"
    max_users: int = Field(default=50, ge=1, le=100)

class RoomUpdate(BaseModel):
    name: Optional[str] = Field(None, min_length=1, max_length=100)
    description: Optional[str] = None
    room_type: Optional[str] = None
    max_users: Optional[int] = Field(None, ge=1, le=100)
    is_active: Optional[bool] = None

class RoomUserResponse(BaseModel):
    id: int
    username: str
    display_name: Optional[str] = None
    avatar_url: Optional[str] = None
    role: str
    
    class Config:
        from_attributes = True

class RoomResponse(BaseModel):
    id: int
    name: str
    description: Optional[str] = None
    room_type: str
    owner_id: int
    is_active: bool
    max_users: int
    current_users: int
    created_at: Optional[datetime] = None
    updated_at: Optional[datetime] = None
    
    class Config:
        from_attributes = True

class RoomDetailResponse(RoomResponse):
    users: List[RoomUserResponse] = []
    
    class Config:
        from_attributes = True