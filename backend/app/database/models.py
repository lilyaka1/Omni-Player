from sqlalchemy import (
    Column, Integer, String, Float, Boolean, DateTime, ForeignKey, Text,
    Table, LargeBinary, Enum as SAEnum
)
from sqlalchemy.orm import relationship, declarative_base
from sqlalchemy.sql import func
import enum
from datetime import datetime

Base = declarative_base()

class UserRole(str, enum.Enum):
    ADMIN = "admin"
    USER = "user"
    DJ = "dj"

class RoomType(str, enum.Enum):
    PUBLIC = "public"
    PRIVATE = "private"

class TrackStatus(str, enum.Enum):
    QUEUED = "queued"
    PLAYING = "playing"
    PAUSED = "paused"
    FINISHED = "finished"
    SKIPPED = "skipped"
    ERROR = "error"

class User(Base):
    __tablename__ = "users"
    
    id = Column(Integer, primary_key=True, index=True)
    username = Column(String(50), unique=True, index=True, nullable=False)
    email = Column(String(100), unique=True, index=True, nullable=False)
    hashed_password = Column(String(255), nullable=False)
    display_name = Column(String(100))
    avatar_url = Column(String(500))
    role = Column(SAEnum(UserRole), default=UserRole.USER)
    is_active = Column(Boolean, default=True)
    created_at = Column(DateTime(timezone=True), server_default=func.now())
    updated_at = Column(DateTime(timezone=True), onupdate=func.now())
    
    # Relationships
    rooms = relationship("Room", back_populates="owner")
    playlists = relationship("Playlist", back_populates="user")
    voice_inserts = relationship("VoiceInsert", back_populates="user")

class Room(Base):
    __tablename__ = "rooms"
    
    id = Column(Integer, primary_key=True, index=True)
    name = Column(String(100), nullable=False)
    description = Column(Text)
    room_type = Column(SAEnum(RoomType), default=RoomType.PUBLIC)
    owner_id = Column(Integer, ForeignKey("users.id"), nullable=False)
    is_active = Column(Boolean, default=True)
    max_users = Column(Integer, default=50)
    current_users = Column(Integer, default=0)
    created_at = Column(DateTime(timezone=True), server_default=func.now())
    updated_at = Column(DateTime(timezone=True), onupdate=func.now())
    
    # Relationships
    owner = relationship("User", back_populates="rooms")
    tracks = relationship("RoomTrack", back_populates="room", cascade="all, delete-orphan")

class Track(Base):
    __tablename__ = "tracks"
    
    id = Column(Integer, primary_key=True, index=True)
    title = Column(String(200), nullable=False)
    artist = Column(String(200))
    album = Column(String(200))
    duration = Column(Float)  # in seconds
    url = Column(String(1000))
    thumbnail_url = Column(String(500))
    source = Column(String(50))  # youtube, soundcloud, local
    source_id = Column(String(200))  # ID from the source platform
    file_path = Column(String(500))  # For local files
    file_size = Column(Integer)  # in bytes
    mime_type = Column(String(100))
    is_processed = Column(Boolean, default=False)
    created_at = Column(DateTime(timezone=True), server_default=func.now())
    
    # Relationships
    room_tracks = relationship("RoomTrack", back_populates="track")

class Playlist(Base):
    __tablename__ = "playlists"
    
    id = Column(Integer, primary_key=True, index=True)
    name = Column(String(200), nullable=False)
    description = Column(Text)
    user_id = Column(Integer, ForeignKey("users.id"), nullable=False)
    is_public = Column(Boolean, default=False)
    created_at = Column(DateTime(timezone=True), server_default=func.now())
    updated_at = Column(DateTime(timezone=True), onupdate=func.now())
    
    # Relationships
    user = relationship("User", back_populates="playlists")

class RoomTrack(Base):
    __tablename__ = "room_tracks"
    
    id = Column(Integer, primary_key=True, index=True)
    room_id = Column(Integer, ForeignKey("rooms.id"), nullable=False)
    track_id = Column(Integer, ForeignKey("tracks.id"), nullable=False)
    added_by_id = Column(Integer, ForeignKey("users.id"))
    position = Column(Integer, default=0)
    status = Column(SAEnum(TrackStatus), default=TrackStatus.QUEUED)
    played_at = Column(DateTime(timezone=True))
    duration_played = Column(Float, default=0.0)  # seconds played
    created_at = Column(DateTime(timezone=True), server_default=func.now())
    
    # Relationships
    room = relationship("Room", back_populates="tracks")
    track = relationship("Track", back_populates="room_tracks")

class VoiceInsert(Base):
    __tablename__ = "voice_inserts"
    
    id = Column(Integer, primary_key=True, index=True)
    user_id = Column(Integer, ForeignKey("users.id"), nullable=False)
    text = Column(Text, nullable=False)
    audio_data = Column(LargeBinary)
    duration = Column(Float)
    is_processed = Column(Boolean, default=False)
    created_at = Column(DateTime(timezone=True), server_default=func.now())
    
    # Relationships
    user = relationship("User", back_populates="voice_inserts")

class RoomUser(Base):
    __tablename__ = "room_users"
    
    id = Column(Integer, primary_key=True, index=True)
    room_id = Column(Integer, ForeignKey("rooms.id"), nullable=False)
    user_id = Column(Integer, ForeignKey("users.id"), nullable=False)
    joined_at = Column(DateTime(timezone=True), server_default=func.now())
    is_active = Column(Boolean, default=True)
    
    # Relationships
    room = relationship("Room")
    user = relationship("User")