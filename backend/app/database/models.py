from sqlalchemy import Column, Integer, String, Boolean, DateTime, ForeignKey, Enum, Float, Table, UniqueConstraint
from sqlalchemy.ext.declarative import declarative_base
from sqlalchemy.orm import relationship
from datetime import datetime
import enum

Base = declarative_base()

class RoleEnum(str, enum.Enum):
    USER = "user"
    ADMIN = "admin"

class RoomRoleEnum(str, enum.Enum):
    ADMIN = "admin"  # Может управлять комнатой, банить юзеров
    USER = "user"  # Просто слушает

class SourceEnum(str, enum.Enum):
    SOUNDCLOUD = "soundcloud"
    YOUTUBE = "youtube"
    SPOTIFY = "spotify"
    LOCAL = "local"

# Association table for many-to-many relationship with roles
user_room_association = Table(
    'user_room',
    Base.metadata,
    Column('user_id', Integer, ForeignKey('user.id')),
    Column('room_id', Integer, ForeignKey('room.id')),
    Column('role', Enum(RoomRoleEnum), default=RoomRoleEnum.USER),
    Column('is_banned', Boolean, default=False),
    Column('joined_at', DateTime, default=datetime.utcnow)
)

class User(Base):
    __tablename__ = "user"
    
    id = Column(Integer, primary_key=True, index=True)
    email = Column(String, unique=True, index=True)
    username = Column(String, unique=True, index=True)
    password_hash = Column(String)
    role = Column(Enum(RoleEnum), default=RoleEnum.USER)
    is_blocked = Column(Boolean, default=False)
    can_create_rooms = Column(Boolean, default=True)
    created_at = Column(DateTime, default=datetime.utcnow)
    
    # Relations
    rooms = relationship("Room", back_populates="creator")
    messages = relationship("Message", back_populates="user")
    tracks_added = relationship("RoomTrack", back_populates="added_by", foreign_keys="RoomTrack.added_by_id")
    joined_rooms = relationship(
        "Room",
        secondary=user_room_association,
        back_populates="users"
    )

class Room(Base):
    __tablename__ = "room"
    
    id = Column(Integer, primary_key=True, index=True)
    creator_id = Column(Integer, ForeignKey('user.id'))
    name = Column(String, index=True)
    description = Column(String)
    is_active = Column(Boolean, default=True)
    
    # Continuous playback tracking (room broadcast mode)
    now_playing_track_id = Column(Integer, ForeignKey('room_track.id', ondelete='SET NULL'), nullable=True)
    playback_started_at = Column(DateTime, nullable=True)  # When current track started
    is_playing = Column(Boolean, default=False)  # Server-side playback state
    queue_mode = Column(String, default='loop')  # 'loop' or 'once'
    
    created_at = Column(DateTime, default=datetime.utcnow)
    updated_at = Column(DateTime, default=datetime.utcnow, onupdate=datetime.utcnow)
    
    # Relations
    creator = relationship("User", back_populates="rooms")
    tracks = relationship("RoomTrack", back_populates="room", foreign_keys="RoomTrack.room_id", cascade="all, delete-orphan")
    now_playing = relationship("RoomTrack", foreign_keys="Room.now_playing_track_id", uselist=False)
    messages = relationship("Message", back_populates="room", cascade="all, delete-orphan")
    users = relationship(
        "User",
        secondary=user_room_association,
        back_populates="joined_rooms"
    )

class RoomTrack(Base):
    __tablename__ = "room_track"
    
    id = Column(Integer, primary_key=True, index=True)
    room_id = Column(Integer, ForeignKey('room.id'))
    source = Column(Enum(SourceEnum), default=SourceEnum.LOCAL)
    source_track_id = Column(String)
    title = Column(String)
    artist = Column(String)
    duration = Column(Float)
    stream_url = Column(String)
    thumbnail = Column(String, nullable=True)
    genre = Column(String, nullable=True)
    order = Column(Integer)
    added_by_id = Column(Integer, ForeignKey('user.id'))
    created_at = Column(DateTime, default=datetime.utcnow)
    
    # Relations
    room = relationship("Room", back_populates="tracks", foreign_keys=[room_id])
    added_by = relationship("User", back_populates="tracks_added", foreign_keys=[added_by_id])

class Message(Base):
    __tablename__ = "message"
    
    id = Column(Integer, primary_key=True, index=True)
    room_id = Column(Integer, ForeignKey('room.id'))
    user_id = Column(Integer, ForeignKey('user.id'))
    content = Column(String)
    created_at = Column(DateTime, default=datetime.utcnow)
    
    # Relations
    room = relationship("Room", back_populates="messages")
    user = relationship("User", back_populates="messages")


# ==================== MUSIC PLAYER MODELS ====================

class Track(Base):
    """Глобальная таблица треков - метаданные для всех пользователей"""
    __tablename__ = "track"
    
    # Identity (дедупликация по source + source_track_id)
    id = Column(Integer, primary_key=True, index=True)
    source = Column(Enum(SourceEnum), nullable=False)
    source_track_id = Column(String, nullable=False)
    source_page_url = Column(String, nullable=False)  # Для refresh stream_url
    
    # Metadata
    title = Column(String, nullable=False)
    artist = Column(String)
    album = Column(String, nullable=True)
    duration = Column(Float)  # Секунды
    genre = Column(String, nullable=True)
    year = Column(Integer, nullable=True)
    
    # Stream URLs (протухают ~24ч)
    stream_url = Column(String, nullable=False)
    stream_url_expires_at = Column(DateTime, nullable=False)
    thumbnail_url = Column(String, nullable=True)
    
    # Audio quality
    bitrate = Column(Integer)  # kbps
    codec = Column(String)     # mp3, opus, aac
    
    # Local storage
    local_file_path = Column(String, nullable=True)  # Путь к локальному файлу
    
    # Global stats
    total_plays = Column(Integer, default=0)
    unique_listeners = Column(Integer, default=0)
    
    # Timestamps
    created_at = Column(DateTime, default=datetime.utcnow)
    updated_at = Column(DateTime, default=datetime.utcnow, onupdate=datetime.utcnow)
    
    # Relations
    users = relationship("UserTrack", back_populates="track")
    playlists = relationship("PlaylistTrack", back_populates="track")
    
    __table_args__ = (
        # Уникальность: один source_track_id на один source
        UniqueConstraint('source', 'source_track_id', name='uq_track_source'),
    )


class UserTrack(Base):
    """M2M: библиотека пользователя с персональными данными"""
    __tablename__ = "user_track"
    
    id = Column(Integer, primary_key=True, index=True)
    user_id = Column(Integer, ForeignKey('user.id'), nullable=False)
    track_id = Column(Integer, ForeignKey('track.id'), nullable=False)
    
    # Персональные данные
    added_at = Column(DateTime, default=datetime.utcnow)
    is_favorite = Column(Boolean, default=False)
    play_count = Column(Integer, default=0)
    last_played_at = Column(DateTime, nullable=True)
    
    # Optional: оценка и заметки
    user_rating = Column(Integer, nullable=True)  # 1-5 stars
    user_notes = Column(String, nullable=True)
    
    # Relations
    user = relationship("User", backref="library_tracks")
    track = relationship("Track", back_populates="users")
    
    __table_args__ = (
        # Уникальность: пользователь не может добавить трек дважды
        UniqueConstraint('user_id', 'track_id', name='uq_user_track'),
    )


class Playlist(Base):
    """Плейлисты и альбомы пользователя"""
    __tablename__ = "playlist"
    
    id = Column(Integer, primary_key=True, index=True)
    owner_id = Column(Integer, ForeignKey('user.id'), nullable=False)
    
    name = Column(String, nullable=False)
    description = Column(String, nullable=True)
    thumbnail = Column(String, nullable=True)
    
    # Type classification
    is_album = Column(Boolean, default=False)  # True = альбом, False = плейлист
    
    # Source tracking (если импортирован)
    source = Column(Enum(SourceEnum), nullable=True)
    source_playlist_id = Column(String, nullable=True)
    
    # Privacy
    is_public = Column(Boolean, default=False)
    
    # Stats (автообновляемые)
    track_count = Column(Integer, default=0)
    total_duration = Column(Float, default=0)
    
    # Timestamps
    created_at = Column(DateTime, default=datetime.utcnow)
    updated_at = Column(DateTime, default=datetime.utcnow, onupdate=datetime.utcnow)
    
    # Relations
    owner = relationship("User", backref="playlists")
    tracks = relationship("PlaylistTrack", back_populates="playlist", cascade="all, delete-orphan")


class PlaylistTrack(Base):
    """M2M: треки в плейлисте с порядком"""
    __tablename__ = "playlist_track"
    
    id = Column(Integer, primary_key=True, index=True)
    playlist_id = Column(Integer, ForeignKey('playlist.id'), nullable=False)
    track_id = Column(Integer, ForeignKey('track.id'), nullable=False)
    
    order = Column(Integer, nullable=False)  # Порядок в плейлисте
    added_at = Column(DateTime, default=datetime.utcnow)
    
    # Relations
    playlist = relationship("Playlist", back_populates="tracks")
    track = relationship("Track", back_populates="playlists")
    
    __table_args__ = (
        # Уникальность: трек не дублируется в плейлисте
        UniqueConstraint('playlist_id', 'track_id', name='uq_playlist_track'),
    )
