"""SQLAlchemy session factory и FastAPI-зависимость get_db."""
from sqlalchemy import create_engine
from sqlalchemy.orm import sessionmaker
from app.core.config import get_settings

settings = get_settings()

# pool_size=20: хватит для одновременных слушателей + WS + broadcast
# pool_pre_ping: переподключение при обрыве idle-соединения
engine = create_engine(
    settings.DATABASE_URL,
    echo=False,
    pool_size=20,
    max_overflow=10,
    pool_pre_ping=True,
    pool_recycle=300,  # переиспользовать соединения каждые 5 минут
)

SessionLocal = sessionmaker(autocommit=False, autoflush=False, bind=engine)


def get_db():
    db = SessionLocal()
    try:
        yield db
    finally:
        db.close()
