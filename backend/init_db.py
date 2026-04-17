import asyncio
from sqlalchemy import create_engine
from app.database.models import Base
from app.core.config import get_settings

settings = get_settings()

def init_db():
    """Initialize database tables"""
    engine = create_engine(settings.DATABASE_URL)
    Base.metadata.create_all(bind=engine)
    print("✅ Database tables created successfully")

if __name__ == "__main__":
    init_db()
