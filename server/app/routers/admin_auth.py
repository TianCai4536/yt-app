"""Admin authentication."""
from __future__ import annotations

from datetime import datetime

from fastapi import APIRouter, Depends, HTTPException, status
from sqlalchemy.orm import Session

from ..core.config import get_settings
from ..core.db import get_db
from ..core.security import create_access_token, create_refresh_token, verify_password
from ..models import Admin

router = APIRouter(prefix="/admin/auth", tags=["admin-auth"])
settings = get_settings()


@router.post("/login")
def admin_login(payload: dict, db: Session = Depends(get_db)) -> dict:
    username = payload.get("username", "")
    password = payload.get("password", "")
    admin = db.query(Admin).filter(Admin.username == username).first()
    if not admin or not verify_password(password, admin.password_hash):
        raise HTTPException(status_code=status.HTTP_401_UNAUTHORIZED, detail="invalid_credentials")
    admin.last_login_at = datetime.utcnow()
    db.commit()
    return {
        "access_token": create_access_token(admin.id, role=admin.role),
        "refresh_token": create_refresh_token(admin.id, role=admin.role),
        "expires_in": settings.access_token_ttl_minutes * 60,
        "admin": {"id": admin.id, "username": admin.username, "display_name": admin.display_name, "role": admin.role},
    }
