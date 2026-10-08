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
