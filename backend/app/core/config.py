from typing import Optional
from pydantic_settings import BaseSettings
from pydantic import ConfigDict

class Settings(BaseSettings):
    # Application
    APP_NAME: str = "Omni Player"
    API_TITLE: str = "Omni Player API"
    API_VERSION: str = "1.0.0"
    DEBUG: bool = False
    API_V1_STR: str = "/api/v1"
    
    # Security
    SECRET_KEY: str = "your-secret-key-here-change-in-production"
    ALGORITHM: str = "HS256"
    ACCESS_TOKEN_EXPIRE_MINUTES: int = 30
    
    # Database
    DATABASE_URL: str = "sqlite:///./omni_player.db"
    
    # Redis (optional, for production)
    REDIS_URL: Optional[str] = None
    
    # Streaming
    MAX_BUFFER_SIZE: int = 8192  # bytes
    BUFFER_TIMEOUT: int = 30  # seconds
    FFMPEG_PATH: str = "ffmpeg"
    
    # Voice inserts
    TTS_ENABLED: bool = True
    TTS_MODEL_PATH: Optional[str] = None
    TTS_MODEL_DIR: Optional[str] = None
    TTS_AUDIO_DIR: Optional[str] = None
    TTS_MAX_CONCURRENT: int = 2
    PIPER_BIN: Optional[str] = None
    RVC_MODEL_PATH: Optional[str] = None
    RVC_MODEL_DIR: Optional[str] = None
    RVC_ENABLED: bool = True
    RVC_CONFIG_PATH: Optional[str] = None
    RVC_SPEAKER: int = 0
    RVC_CACHE_DIR: Optional[str] = None
    RVC_DEFAULT_PITCH: int = 0
    RVC_INDEX_RATE: float = 0.75
    RVC_PROTECT: float = 0.33
    MAX_CONCURRENT_RVC: int = 2

    # HLS
    HLS_ENABLED: bool = True
    HLS_SEGMENT_DURATION: int = 6
    HLS_USE_S3: bool = False

    # CORS
    ALLOWED_ORIGINS: Optional[str] = None

    # Room settings
    MAX_ROOM_USERS: int = 100
    MAX_QUEUE_SIZE: int = 50

    # Storage
    DOWNLOADS_DIR: str = "./downloads"
    UPLOADS_DIR: str = "./backend/static/uploads"
    AVATARS_SUBDIR: str = "avatars"
    COVERS_SUBDIR: str = "covers"
    ROOM_COVERS_SUBDIR: str = "room-covers"

    model_config = ConfigDict(
        env_file=".env",
        env_file_encoding="utf-8",
        case_sensitive=True,
        extra="ignore",
    )

settings = Settings()


def get_settings() -> Settings:
    """Совместимость со старым кодом (ожидающим callable)."""
    return settings
