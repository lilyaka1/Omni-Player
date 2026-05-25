from typing import Generator, Optional
from fastapi import Depends, HTTPException, status, WebSocket
from fastapi.security import HTTPBearer, HTTPAuthorizationCredentials
from sqlalchemy.orm import Session
from app.database.session import SessionLocal
from app.room.manager import RoomManager
from app.database.models import User
from jose import JWTError, jwt

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
    db: Session = Depends(get_db),
) -> User:
    """Get authenticated user from JWT token or raise 401."""
    if credentials is None:
        raise HTTPException(
            status_code=status.HTTP_401_UNAUTHORIZED,
            detail="Not authenticated",
            headers={"WWW-Authenticate": "Bearer"},
        )
    
    token = credentials.credentials
    try:
        from app.core.config import settings
        payload = jwt.decode(
            token,
            settings.SECRET_KEY,
            algorithms=[settings.ALGORITHM]
        )
        user_id_raw = payload.get("sub")
        if user_id_raw is None:
            return None
        user_id = int(user_id_raw)
    except JWTError:
        raise HTTPException(
            status_code=status.HTTP_401_UNAUTHORIZED,
            detail="Invalid token",
            headers={"WWW-Authenticate": "Bearer"},
        )
    except (TypeError, ValueError):
        raise HTTPException(
            status_code=status.HTTP_401_UNAUTHORIZED,
            detail="Invalid token payload",
            headers={"WWW-Authenticate": "Bearer"},
        )
    
    user = db.query(User).filter(User.id == user_id).first()
    if not user:
        raise HTTPException(
            status_code=status.HTTP_401_UNAUTHORIZED,
            detail="User not found",
            headers={"WWW-Authenticate": "Bearer"},
        )
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
        user_id_raw = payload.get("sub")
        if user_id_raw is None:
            return None
        user_id = int(user_id_raw)
    except jwt.PyJWTError:
        return None
    except (TypeError, ValueError):
        return None
    
    user = db.query(User).filter(User.id == user_id).first()
    return user