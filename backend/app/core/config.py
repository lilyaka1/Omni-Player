from pydantic_settings import BaseSettings
from functools import lru_cache


class Settings(BaseSettings):
    # Database
    DATABASE_URL: str = "postgresql+psycopg://user:password@localhost:5432/omni_player"

    # Auth
    SECRET_KEY: str = "your-secret-key-change-in-production"
    ALGORITHM: str = "HS256"
    ACCESS_TOKEN_EXPIRE_MINUTES: int = 43200  # 30 дней

    # API
    API_TITLE: str = "Omni Player Backend"
    API_VERSION: str = "1.0.0"
    
    # Downloads
    DOWNLOADS_DIR: str = "./downloads"  # Папка для загрузки треков

    class Config:
        env_file = ".env"
        case_sensitive = True


@lru_cache()
def get_settings() -> Settings:
    return Settings()
