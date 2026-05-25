from datetime import datetime, timedelta
from typing import Optional

from jose import JWTError, jwt
from passlib.context import CryptContext
from sqlalchemy.orm import Session

from app.core.config import settings
from app.database.models import User, UserRole

pwd_context = CryptContext(schemes=["bcrypt"], deprecated="auto")


# ──────────────────────────────────────────────────────────────────────────────
#  Module-level helpers (используются WS handlers и stream router)
# ──────────────────────────────────────────────────────────────────────────────
def decode_token(token: str) -> Optional[str]:
    """
    Возвращает email/sub из JWT токена либо None, если токен битый/просрочен.
    """
    if not token:
        return None
    try:
        payload = jwt.decode(token, settings.SECRET_KEY, algorithms=[settings.ALGORITHM])
        return payload.get("sub") or payload.get("email")
    except JWTError:
        return None


# ──────────────────────────────────────────────────────────────────────────────
#  AuthService
# ──────────────────────────────────────────────────────────────────────────────
class AuthService:
    def __init__(self, db: Session):
        self.db = db

    # password ──────────────────────────────────────────────────────────────
    def verify_password(self, plain_password: str, hashed_password: str) -> bool:
        return pwd_context.verify(plain_password, hashed_password)

    def get_password_hash(self, password: str) -> str:
        return pwd_context.hash(password)

    # tokens ────────────────────────────────────────────────────────────────
    def create_access_token(
        self, data: dict, expires_delta: Optional[timedelta] = None
    ) -> str:
        to_encode = data.copy()
        expire = datetime.utcnow() + (
            expires_delta
            or timedelta(minutes=settings.ACCESS_TOKEN_EXPIRE_MINUTES)
        )
        to_encode.update({"exp": expire})
        return jwt.encode(to_encode, settings.SECRET_KEY, algorithm=settings.ALGORITHM)

    # auth ──────────────────────────────────────────────────────────────────
    def authenticate_user(self, username: str, password: str) -> Optional[User]:
        user = self.db.query(User).filter(User.username == username).first()
        if not user or not self.verify_password(password, user.password_hash):
            return None
        return user

    def authenticate_user_by_email(self, email: str, password: str) -> Optional[User]:
        user = self.db.query(User).filter(User.email == email).first()
        if not user or not self.verify_password(password, user.password_hash):
            return None
        return user

    # users ─────────────────────────────────────────────────────────────────
    def create_user(self, username: str, email: str, password: str) -> User:
        user = User(
            username=username,
            email=email,
            password_hash=self.get_password_hash(password),
            role=UserRole.USER.value,
        )
        self.db.add(user)
        self.db.commit()
        self.db.refresh(user)
        return user

    def get_user_by_id(self, user_id: int) -> Optional[User]:
        return self.db.query(User).filter(User.id == user_id).first()

    def get_user_by_username(self, username: str) -> Optional[User]:
        return self.db.query(User).filter(User.username == username).first()

    def get_user_by_email(self, email: str) -> Optional[User]:
        return self.db.query(User).filter(User.email == email).first()
