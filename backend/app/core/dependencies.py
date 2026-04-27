from typing import Generator, Optional
from fastapi import Depends, HTTPException, status, WebSocket
from fastapi.security import HTTPBearer, HTTPAuthorizationCredentials
from sqlalchemy.orm import Session
from app.database.session import SessionLocal
from app.room.manager import RoomManager
from app.database.models import User
from jose import jwt

security = HTTPBearer(auto_error=False)

def get_db() -> Generator[Session, None, None]:
    """Dependency that provides a database session."""
    db = SessionLocal()
    try:
        yield db
    finally:
        db.close()

def get_current_user(
    credentials: Optional[HTTPAuthorizationCredentials] = Depends(security),
    db: Session = Depends(get_db)
) -> Optional[User]:
    """Get current user from JWT token."""
    if credentials is None:
        return None
    
    token = credentials.credentials
    try:
        from app.core.config import settings
        payload = jwt.decode(
            token,
            settings.SECRET_KEY,
            algorithms=[settings.ALGORITHM]
        )
        user_id: str = payload.get("sub")
        if user_id is None:
            return None
    except jwt.PyJWTError:
        return None
    
    user = db.query(User).filter(User.id == user_id).first()
    return user

def get_room_manager() -> RoomManager:
    """Dependency that provides the room manager singleton."""
    return RoomManager()

async def get_current_user_ws(
    websocket: WebSocket,
    db: Session = Depends(get_db)
) -> Optional[User]:
    """Get current user from WebSocket connection."""
    token = websocket.query_params.get("token")
    if not token:
        return None
    
    try:
        from app.core.config import settings
        payload = jwt.decode(
            token,
            settings.SECRET_KEY,
            algorithms=[settings.ALGORITHM]
        )
        user_id: str = payload.get("sub")
        if user_id is None:
            return None
    except jwt.PyJWTError:
        return None
    
    user = db.query(User).filter(User.id == user_id).first()
    return user