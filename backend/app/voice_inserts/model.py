"""Voice Insert model + DB schema."""
from datetime import datetime
from sqlalchemy import Column, Integer, String, Boolean, DateTime, ForeignKey, Text, Float
from app.database.models import Base


class VoiceInsert(Base):
    __tablename__ = "voice_insert"

    id = Column(Integer, primary_key=True, index=True)
    room_id = Column(Integer, ForeignKey("room.id", ondelete="CASCADE"), nullable=False)
    admin_id = Column(Integer, ForeignKey("user.id"), nullable=False)

    # Контент
    text = Column(Text, nullable=False)
    voice_id = Column(String(64), nullable=False, default="en_US-libritts-high")

    # Генерация
    status = Column(String(20), nullable=False, default="pending")
    audio_path = Column(String(512), nullable=True)
    duration_sec = Column(Float, nullable=True)
    content_hash = Column(String(64), nullable=False)
    error_message = Column(Text, nullable=True)

    # Планирование
    scheduled_at = Column(DateTime, nullable=False)
    play_after_track_id = Column(Integer, ForeignKey("room_track.id", ondelete="SET NULL"), nullable=True)

    # Время жизни
    created_at = Column(DateTime, default=datetime.utcnow)
    is_auto = Column(Boolean, default=False)  # True = pre-generated common phrase
