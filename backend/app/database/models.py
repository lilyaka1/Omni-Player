"""
ORM-модели проекта Omni Player.

Источник правды — БД `omni_local.db` (singular table names: room, room_track, track, user…).
Любые расхождения с этой схемой считать ошибкой.
"""
import enum
from datetime import datetime

from sqlalchemy import (
    Boolean, Column, DateTime, Enum as SAEnum, Float, ForeignKey, Integer,
    String, Text,
)
from sqlalchemy.orm import declarative_base, relationship

Base = declarative_base()


class UserRole(str, enum.Enum):
    ADMIN = "admin"
    USER = "user"
    DJ = "dj"


class SourceEnum(str, enum.Enum):
    SOUNDCLOUD = "soundcloud"
    YOUTUBE = "youtube"
    LOCAL = "local"


# ──────────────────────────────────────────────────────────────────────────────
#  User / Room (singular)
# ──────────────────────────────────────────────────────────────────────────────

class User(Base):
    __tablename__ = "user"

    id = Column(Integer, primary_key=True, index=True)
    email = Column(String, unique=True, index=True)
    username = Column(String, unique=True, index=True)
    password_hash = Column(String)
    role = Column(String(5), default=UserRole.USER.value)
    is_blocked = Column(Boolean, default=False)
    can_create_rooms = Column(Boolean, default=True)
    created_at = Column(DateTime, default=datetime.utcnow)

    # Profile fields
    display_name = Column(String, nullable=True)
    avatar_url = Column(String, nullable=True)
    bio = Column(Text, nullable=True)
    location = Column(String, nullable=True)
    website = Column(String, nullable=True)
    downloads_subdir = Column(String, nullable=True)


class Room(Base):
    __tablename__ = "room"

    id = Column(Integer, primary_key=True, index=True)
    creator_id = Column(Integer, ForeignKey("user.id"))
    name = Column(String, index=True)
    description = Column(String)
    is_active = Column(Boolean, default=True)

    cover_url = Column(String, nullable=True)
    genre = Column(String, nullable=True)
    room_type = Column(String, default="public")
    password_hash = Column(String, nullable=True)  # Для приватных комнат с паролем
    max_users = Column(Integer, default=50)

    # Playback state
    now_playing_track_id = Column(
        Integer,
        ForeignKey("room_track.id", ondelete="SET NULL"),
        nullable=True,
    )
    playback_started_at = Column(DateTime)
    is_playing = Column(Boolean, default=False)
    queue_mode = Column(String, default="normal")  # normal | loop | shuffle

    created_at = Column(DateTime, default=datetime.utcnow)
    updated_at = Column(DateTime, onupdate=datetime.utcnow)


class RoomTrack(Base):
    __tablename__ = "room_track"

    id = Column(Integer, primary_key=True, index=True)
    room_id = Column(Integer, ForeignKey("room.id"))

    # Источник
    source = Column(String(10))
    source_track_id = Column(String)

    # Метаданные
    title = Column(String)
    artist = Column(String)
    duration = Column(Float)
    stream_url = Column(String)  # ⚠️ теперь сюда пишется ЛОКАЛЬНЫЙ путь к mp3,
                                  # либо http URL для legacy-данных
    thumbnail = Column(String)
    genre = Column(String)

    order = Column("order", Integer)
    added_by_id = Column(Integer, ForeignKey("user.id"))
    created_at = Column(DateTime, default=datetime.utcnow)


class Track(Base):
    """Глобальный каталог треков (используется TrackService / library)."""
    __tablename__ = "track"

    id = Column(Integer, primary_key=True, index=True)
    source = Column(String(10), nullable=False)
    source_track_id = Column(String, nullable=False)
    source_page_url = Column(String, nullable=False)

    title = Column(String, nullable=False)
    artist = Column(String)
    album = Column(String)
    duration = Column(Float)
    genre = Column(String)
    year = Column(Integer)

    stream_url = Column(String, nullable=False)
    stream_url_expires_at = Column(DateTime, nullable=False)
    thumbnail_url = Column(String)
    bitrate = Column(Integer)
    codec = Column(String)
    local_file_path = Column(String)

    total_plays = Column(Integer, default=0)
    unique_listeners = Column(Integer, default=0)

    created_at = Column(DateTime, default=datetime.utcnow)
    updated_at = Column(DateTime, onupdate=datetime.utcnow)


class UserRoom(Base):
    __tablename__ = "user_room"

    user_id = Column(Integer, ForeignKey("user.id"), primary_key=True)
    room_id = Column(Integer, ForeignKey("room.id"), primary_key=True)
    role = Column(String(5), default="user")
    is_banned = Column(Boolean, default=False)
    joined_at = Column(DateTime, default=datetime.utcnow)


class Message(Base):
    __tablename__ = "message"

    id = Column(Integer, primary_key=True, index=True)
    room_id = Column(Integer, ForeignKey("room.id"))
    user_id = Column(Integer, ForeignKey("user.id"))
    content = Column(String)
    created_at = Column(DateTime, default=datetime.utcnow)


class UserTrack(Base):
    __tablename__ = "user_track"

    id = Column(Integer, primary_key=True, index=True)
    user_id = Column(Integer, ForeignKey("user.id"), nullable=False)
    track_id = Column(Integer, ForeignKey("track.id"), nullable=False)
    added_at = Column(DateTime, default=datetime.utcnow)
    is_favorite = Column(Boolean, default=False)
    play_count = Column(Integer, default=0)
    last_played_at = Column(DateTime)
    user_rating = Column(Integer)
    user_notes = Column(String)


class Playlist(Base):
    __tablename__ = "playlist"

    id = Column(Integer, primary_key=True, index=True)
    owner_id = Column(Integer, ForeignKey("user.id"), nullable=False)
    name = Column(String, nullable=False)
    description = Column(String)
    thumbnail = Column(String)
    is_album = Column(Boolean, default=False)
    source = Column(String(10))
    source_playlist_id = Column(String)
    is_public = Column(Boolean, default=False)
    track_count = Column(Integer, default=0)
    total_duration = Column(Float, default=0.0)
    created_at = Column(DateTime, default=datetime.utcnow)
    updated_at = Column(DateTime, onupdate=datetime.utcnow)


class PlaylistTrack(Base):
    __tablename__ = "playlist_track"

    id = Column(Integer, primary_key=True, index=True)
    playlist_id = Column(Integer, ForeignKey("playlist.id"), nullable=False)
    track_id = Column(Integer, ForeignKey("track.id"), nullable=False)
    order = Column("order", Integer, nullable=False)
    added_at = Column(DateTime, default=datetime.utcnow)


# ──────────────────────────────────────────────────────────────────────────────
#  Backward-compat aliases (старый код кое-где импортирует множественные имена)
# ──────────────────────────────────────────────────────────────────────────────
TrackStatus = enum.Enum(
    "TrackStatus",
    {"QUEUED": "queued", "PLAYING": "playing", "FINISHED": "finished",
     "SKIPPED": "skipped", "ERROR": "error"},
    type=str,
)

RoomType = enum.Enum("RoomType", {"PUBLIC": "public", "PRIVATE": "private"}, type=str)


class RoomRoleEnum(str, enum.Enum):
    ADMIN = "admin"
    USER = "user"
    DJ = "dj"


# Старый код иногда импортирует `RoomUser` — это просто другое имя UserRoom.
RoomUser = UserRoom

# Некоторые модули обращаются к ассоциативной таблице как к Core-объекту.
user_room_association = UserRoom.__table__

