"""
Общие FastAPI-зависимости для всего приложения.
Импортируй get_current_user / get_admin_user вместо того,
чтобы дублировать их в каждом роутере.
"""
from fastapi import Depends, Header, HTTPException, status
from sqlalchemy.orm import Session

from app.database.session import get_db
from app.database.models import User, RoleEnum
from app.domains.auth.service import decode_token


async def get_current_user(
    authorization: str = Header(None),
    db: Session = Depends(get_db),
) -> User:
    """Возвращает текущего пользователя по JWT-токену из заголовка Authorization."""
    if not authorization:
        raise HTTPException(
            status_code=status.HTTP_401_UNAUTHORIZED,
            detail="Not authenticated",
        )
    token = authorization.split(" ")[-1]
    email = decode_token(token)
    if not email:
        raise HTTPException(
            status_code=status.HTTP_401_UNAUTHORIZED,
            detail="Invalid token",
        )
    user = db.query(User).filter(User.email == email).first()
    if not user:
        raise HTTPException(
            status_code=status.HTTP_401_UNAUTHORIZED,
            detail="User not found",
        )
    if user.is_blocked:
        raise HTTPException(
            status_code=status.HTTP_403_FORBIDDEN,
            detail="User is blocked",
        )
    return user


async def get_current_user_optional(
    authorization: str = Header(None),
    db: Session = Depends(get_db),
) -> User | None:
    """Возвращает пользователя, но не валит запрос если токен отсутствует или просрочен."""
    if not authorization:
        return None
    token = authorization.split(" ")[-1]
    email = decode_token(token)
    if not email:
        return None
    user = db.query(User).filter(User.email == email).first()
    if not user or user.is_blocked:
        return None
    return user


async def get_admin_user(
    authorization: str = Header(None),
    db: Session = Depends(get_db),
) -> User:
    """Возвращает пользователя, проверяя наличие роли ADMIN."""
    user = await get_current_user(authorization=authorization, db=db)
    if user.role != RoleEnum.ADMIN:
        raise HTTPException(
            status_code=status.HTTP_403_FORBIDDEN,
            detail="Admin access required",
        )
    return user
