from pydantic import BaseModel
from typing import Optional, List
from datetime import datetime


class RoomTrackCreate(BaseModel):
    source: str
    source_track_id: str
    title: str
    artist: str
    duration: float
    stream_url: str
    thumbnail: Optional[str] = None
    genre: Optional[str] = None


class RoomTrackResponse(BaseModel):
    id: int
    room_id: int
    source: str
    source_track_id: Optional[str] = None
    title: str
    artist: str
    duration: float
    stream_url: Optional[str] = None
    thumbnail: Optional[str] = None
    genre: Optional[str] = None
    order: Optional[int] = None
    created_at: datetime

    class Config:
        from_attributes = True


class RoomCreate(BaseModel):
    name: str
    description: Optional[str] = None


class RoomUpdate(BaseModel):
    name: Optional[str] = None
    description: Optional[str] = None


class RoomResponse(BaseModel):
    id: int
    creator_id: int
    name: str
    description: Optional[str]
    is_active: bool
    created_at: datetime
    updated_at: datetime
    tracks: List[RoomTrackResponse] = []

    class Config:
        from_attributes = True


class RoomDetailResponse(RoomResponse):
    online_count: int = 0
    is_playing: bool = False
    queue_mode: str = "loop"
