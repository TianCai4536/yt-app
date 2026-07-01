"""Current-user information endpoints."""
from __future__ import annotations

import json

from fastapi import APIRouter, Depends, HTTPException, status
from sqlalchemy.orm import Session

from ..core.db import get_db
from ..core.security import hash_password, verify_password
from ..deps import get_current_user
from ..models import CreditLog, Model, UsageLog, User, UserModel
from ..schemas import ChangePasswordRequest, MeResponse, ModelPublic, UserPublic

router = APIRouter(prefix="/me", tags=["me"])


@router.get("", response_model=MeResponse)
def me(user: User = Depends(get_current_user), db: Session = Depends(get_db)) -> MeResponse:
    rows = (
        db.query(Model)
        .join(UserModel, UserModel.model_id == Model.id)
        .filter(UserModel.user_id == user.id, Model.enabled.is_(True))
        .order_by(Model.sort_order, Model.id)
        .all()
    )
    base = UserPublic.model_validate(user)
    resp = MeResponse(**base.model_dump(), models=[ModelPublic.model_validate(m) for m in rows])
    return resp


@router.get("/settings")
def get_settings(user: User = Depends(get_current_user)) -> dict:
    try:
        s = json.loads(user.settings) if user.settings else {}
    except (ValueError, TypeError):
        s = {}
    return {
        "default_model": s.get("default_model"),
        "temperature": s.get("temperature", 0.7),
        "system_prompt": s.get("system_prompt", ""),
        "send_on_enter": s.get("send_on_enter", True),
        "theme": s.get("theme", "dark"),
    }


@router.put("/settings")
def put_settings(payload: dict, user: User = Depends(get_current_user), db: Session = Depends(get_db)) -> dict:
    try:
        s = json.loads(user.settings) if user.settings else {}
    except (ValueError, TypeError):
        s = {}
    for k in ("default_model", "temperature", "system_prompt", "send_on_enter", "theme"):
        if k in payload:
            s[k] = payload[k]
    user.settings = json.dumps(s, ensure_ascii=False)
    db.commit()
    return s


@router.patch("/profile")
def update_profile(payload: dict, user: User = Depends(get_current_user), db: Session = Depends(get_db)) -> dict:
    if "display_name" in payload and payload["display_name"] is not None:
        user.display_name = payload["display_name"][:64]
    if "email" in payload:
        user.email = payload["email"]
    db.commit()
    return {"id": user.id, "username": user.username, "display_name": user.display_name, "email": user.email}


@router.get("/usage")
def my_usage(page: int = 1, size: int = 20, user: User = Depends(get_current_user), db: Session = Depends(get_db)) -> dict:
    q = db.query(UsageLog).filter(UsageLog.user_id == user.id)
    total = q.count()
    rows = q.order_by(UsageLog.id.desc()).offset((page - 1) * size).limit(size).all()
    model_names = {m.id: m.display_name for m in db.query(Model).all()}
    return {
        "total": total,
        "items": [{
            "id": r.id, "model": model_names.get(r.model_id, "?"),
            "total_tokens": r.total_tokens, "credits_charged": r.credits_charged,
            "status": r.status, "created_at": r.created_at,
        } for r in rows],
    }


@router.get("/credit-logs")
def my_credit_logs(page: int = 1, size: int = 20, user: User = Depends(get_current_user), db: Session = Depends(get_db)) -> dict:
    q = db.query(CreditLog).filter(CreditLog.user_id == user.id)
    total = q.count()
    rows = q.order_by(CreditLog.id.desc()).offset((page - 1) * size).limit(size).all()
    reason_text = {"recharge": "充值", "usage": "消耗", "refund": "退款", "admin_adjust": "管理员调整"}
    return {
        "total": total,
        "items": [{
            "id": r.id, "delta": r.delta, "balance_after": r.balance_after,
            "reason": reason_text.get(r.reason, r.reason), "note": r.note,
            "created_at": r.created_at,
        } for r in rows],
    }


@router.post("/change-password", status_code=status.HTTP_204_NO_CONTENT)
def change_password(
    payload: ChangePasswordRequest,
    user: User = Depends(get_current_user),
    db: Session = Depends(get_db),
) -> None:
    if not verify_password(payload.old_password, user.password_hash):
        raise HTTPException(status_code=status.HTTP_400_BAD_REQUEST, detail="invalid_old_password")
    user.password_hash = hash_password(payload.new_password)
    db.commit()
