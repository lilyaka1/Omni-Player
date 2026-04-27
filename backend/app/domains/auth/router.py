from fastapi import APIRouter, Depends, HTTPException, status
from sqlalchemy.orm import Session
from app.core.dependencies import get_db, get_current_user
from app.domains.auth.service import AuthService
from app.domains.auth.schemas import UserCreate, UserLogin, Token, UserResponse
from app.database.models import User

router = APIRouter(prefix="/auth", tags=["authentication"])


@router.post("/register", response_model=Token, status_code=status.HTTP_201_CREATED)
def register(user_data: UserCreate, db: Session = Depends(get_db)):
    """Register a new user."""
    auth_service = AuthService(db)
    
    # Check if username already exists
    if auth_service.get_user_by_username(user_data.username):
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail="Username already exists"
        )
    
    # Check if email already exists
    if auth_service.get_user_by_email(user_data.email):
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail="Email already exists"
        )
    
    # Create user
    user = auth_service.create_user(
        username=user_data.username,
        email=user_data.email,
        password=user_data.password
    )
    
    # Create access token
    access_token = auth_service.create_access_token(
        data={"sub": str(user.id), "username": user.username}
    )
    
    return Token(
        access_token=access_token,
        user=UserResponse.model_validate(user)
    )


@router.post("/login", response_model=Token)
def login(login_data: UserLogin, db: Session = Depends(get_db)):
    """Login user."""
    auth_service = AuthService(db)
    
    # Validate that at least one identifier is provided
    if not login_data.username and not login_data.email:
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail="Username or email is required"
        )
    
    # Try to authenticate with username or email
    user = None
    if login_data.email:
        user = auth_service.authenticate_user_by_email(
            email=login_data.email,
            password=login_data.password
        )
    elif login_data.username:
        user = auth_service.authenticate_user(
            username=login_data.username,
            password=login_data.password
        )
    
    if not user:
        raise HTTPException(
            status_code=status.HTTP_401_UNAUTHORIZED,
            detail="Incorrect username or password",
            headers={"WWW-Authenticate": "Bearer"}
        )
    
    # Create access token
    access_token = auth_service.create_access_token(
        data={"sub": str(user.id), "username": user.username}
    )
    
    return Token(
        access_token=access_token,
        user=UserResponse.model_validate(user)
    )


@router.get("/me", response_model=UserResponse)
def get_current_user_info(
    current_user: User = Depends(get_current_user),
    db: Session = Depends(get_db)
):
    """Get current user information."""
    if not current_user:
        raise HTTPException(
            status_code=status.HTTP_401_UNAUTHORIZED,
            detail="Not authenticated"
        )
    return UserResponse.model_validate(current_user)