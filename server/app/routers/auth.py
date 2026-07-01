"""User authentication endpoints."""
from __future__ import annotations

from datetime import datetime, timezone

from fastapi import APIRouter, Depends, HTTPException, status
from jose import JWTError
from sqlalchemy.orm import Session

from ..core.db import get_db
from ..core.security import (
    create_access_token,
    create_refresh_token,
    decode_token,
    verify_password,
)
from ..core.config import get_settings
from ..models import User
from ..schemas import (
    AccessTokenOnly,
    LoginRequest,
    LoginResponse,
    RefreshRequest,
    UserPublic,
)

router = APIRouter(prefix="/auth", tags=["auth"])
settings = get_settings()


@router.post("/login", response_model=LoginResponse)
def login(payload: LoginRequest, db: Session = Depends(get_db)) -> LoginResponse:
    user = db.query(User).filter(User.username == payload.username).first()
    if not user or not verify_password(payload.password, user.password_hash):
        raise HTTPException(status_code=status.HTTP_401_UNAUTHORIZED, detail="invalid_credentials")
    if user.status != "active":
        raise HTTPException(status_code=status.HTTP_403_FORBIDDEN, detail=f"account_{user.status}")
    if user.expires_at and user.expires_at < datetime.now(timezone.utc).replace(tzinfo=None):
        raise HTTPException(status_code=status.HTTP_403_FORBIDDEN, detail="account_expired")

    user.last_login_at = datetime.utcnow()
    db.commit()
    db.refresh(user)

    access = create_access_token(user.id, role="user")
    refresh = create_refresh_token(user.id, role="user")
    return LoginResponse(
        access_token=access,
        refresh_token=refresh,
        expires_in=settings.access_token_ttl_minutes * 60,
        user=UserPublic.model_validate(user),
    )


@router.post("/refresh", response_model=AccessTokenOnly)
def refresh(payload: RefreshRequest, db: Session = Depends(get_db)) -> AccessTokenOnly:
    try:
        data = decode_token(payload.refresh_token)
    except JWTError:
        raise HTTPException(status_code=status.HTTP_401_UNAUTHORIZED, detail="invalid_refresh_token")
    if data.get("type") != "refresh":
        raise HTTPException(status_code=status.HTTP_401_UNAUTHORIZED, detail="invalid_token_type")

    sub = int(data["sub"])
    role = data.get("role", "user")
    if role == "user":
        if not db.get(User, sub):
            raise HTTPException(status_code=status.HTTP_401_UNAUTHORIZED, detail="user_not_found")
    access = create_access_token(sub, role=role)
    return AccessTokenOnly(access_token=access, expires_in=settings.access_token_ttl_minutes * 60)


@router.post("/logout", status_code=status.HTTP_204_NO_CONTENT)
def logout() -> None:
    """Stateless JWT — logout is a client-side discard of token (token revocation list TODO)."""
    return None
