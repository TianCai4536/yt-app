"""Admin CRUD: users / models / recharge / grant / stats."""
from __future__ import annotations

from datetime import datetime, timedelta

from fastapi import APIRouter, Depends, HTTPException, Query
from sqlalchemy import func
from sqlalchemy.orm import Session

from ..core.crypto import encrypt
from ..core.db import get_db
from ..core.security import hash_password
from ..deps import get_current_admin
from ..models import Admin, Conversation, CreditLog, Message, Model, UsageLog, User, UserModel
from ..schemas import (
    AdminCreateModel,
    AdminCreateUser,
    AdminPatchModel,
    AdminPatchUser,
    AdminRechargeRequest,
)

router = APIRouter(prefix="/admin", tags=["admin"])


def _user_dict(db: Session, u: User) -> dict:
    keys = [
        m.model_key
        for m in db.query(Model).join(UserModel, UserModel.model_id == Model.id)
        .filter(UserModel.user_id == u.id).all()
    ]
    return {
        "id": u.id, "username": u.username, "display_name": u.display_name,
        "email": u.email, "phone": u.phone, "credits": u.credits,
        "status": u.status, "expires_at": u.expires_at, "notes": u.notes,
        "last_login_at": u.last_login_at, "created_at": u.created_at,
        "model_keys": keys,
    }


def _set_models(db: Session, user: User, model_keys: list[str], admin: Admin) -> None:
    db.query(UserModel).filter(UserModel.user_id == user.id).delete()
    for key in model_keys:
        m = db.query(Model).filter(Model.model_key == key).first()
        if m:
            db.add(UserModel(user_id=user.id, model_id=m.id, granted_by=admin.id))


# ---------------- Users ----------------

@router.get("/users")
def list_users(
    page: int = 1, size: int = 20, search: str | None = None, status: str | None = None,
    admin: Admin = Depends(get_current_admin), db: Session = Depends(get_db),
) -> dict:
    q = db.query(User)
    if search:
        like = f"%{search}%"
        q = q.filter((User.username.like(like)) | (User.display_name.like(like)))
    if status:
        q = q.filter(User.status == status)
    total = q.count()
    rows = q.order_by(User.id.desc()).offset((page - 1) * size).limit(size).all()
    return {"items": [_user_dict(db, u) for u in rows], "total": total}


@router.get("/users/{uid}")
def get_user(uid: int, admin: Admin = Depends(get_current_admin), db: Session = Depends(get_db)) -> dict:
    u = db.get(User, uid)
    if not u:
        raise HTTPException(404, "not_found")
    return _user_dict(db, u)


@router.post("/users")
def create_user(body: AdminCreateUser, admin: Admin = Depends(get_current_admin), db: Session = Depends(get_db)) -> dict:
    if db.query(User).filter(User.username == body.username).first():
        raise HTTPException(400, "username_exists")
    u = User(
        username=body.username, password_hash=hash_password(body.password),
        display_name=body.display_name, email=body.email, phone=body.phone,
        credits=body.initial_credits, expires_at=body.expires_at,
    )
    db.add(u)
    db.flush()
    if body.initial_credits:
        db.add(CreditLog(user_id=u.id, delta=body.initial_credits, balance_after=u.credits,
                         reason="recharge", operator_admin=admin.id, note="初始积分"))
    _set_models(db, u, body.model_keys, admin)
    db.commit()
    return _user_dict(db, u)


@router.patch("/users/{uid}")
def patch_user(uid: int, body: AdminPatchUser, admin: Admin = Depends(get_current_admin), db: Session = Depends(get_db)) -> dict:
    u = db.get(User, uid)
    if not u:
        raise HTTPException(404, "not_found")
    if body.display_name is not None: u.display_name = body.display_name
    if body.email is not None: u.email = body.email
    if body.phone is not None: u.phone = body.phone
    if body.status is not None: u.status = body.status
    if body.expires_at is not None: u.expires_at = body.expires_at
    if body.notes is not None: u.notes = body.notes
    if body.new_password: u.password_hash = hash_password(body.new_password)
    if body.model_keys is not None: _set_models(db, u, body.model_keys, admin)
    db.commit()
    return _user_dict(db, u)


@router.post("/users/{uid}/recharge")
def recharge(uid: int, body: AdminRechargeRequest, admin: Admin = Depends(get_current_admin), db: Session = Depends(get_db)) -> dict:
    u = db.get(User, uid)
    if not u:
        raise HTTPException(404, "not_found")
    u.credits = max(0, u.credits + body.delta)
    db.add(CreditLog(user_id=u.id, delta=body.delta, balance_after=u.credits,
                     reason="admin_adjust", operator_admin=admin.id, note=body.note))
    db.commit()
    return {"credits_after": u.credits}


@router.delete("/users/{uid}")
def delete_user(uid: int, admin: Admin = Depends(get_current_admin), db: Session = Depends(get_db)) -> dict:
    u = db.get(User, uid)
    if not u:
        raise HTTPException(404, "not_found")
    u.status = "deleted"
    db.commit()
    return {"ok": True}


@router.get("/users/{uid}/usage")
def user_usage(uid: int, page: int = 1, size: int = 20, admin: Admin = Depends(get_current_admin), db: Session = Depends(get_db)) -> dict:
    q = db.query(UsageLog).filter(UsageLog.user_id == uid)
    total = q.count()
    rows = q.order_by(UsageLog.id.desc()).offset((page - 1) * size).limit(size).all()
    return {"items": [{
        "id": r.id, "model_id": r.model_id, "total_tokens": r.total_tokens,
        "credits_charged": r.credits_charged, "status": r.status,
        "latency_ms": r.latency_ms, "created_at": r.created_at,
    } for r in rows], "total": total}


# ---------------- Models ----------------

@router.get("/models")
def list_models(admin: Admin = Depends(get_current_admin), db: Session = Depends(get_db)) -> dict:
    rows = db.query(Model).order_by(Model.sort_order, Model.id).all()
    return {"items": [{
        "id": m.id, "model_key": m.model_key, "display_name": m.display_name,
        "provider": m.provider, "upstream_url": m.upstream_url, "upstream_model": m.upstream_model,
        "credit_rate": m.credit_rate, "context_window": m.context_window,
        "supports_tools": m.supports_tools, "supports_stream": m.supports_stream,
        "enabled": m.enabled, "sort_order": m.sort_order,
        "api_key_set": bool(m.api_key_enc),
    } for m in rows]}


@router.post("/models")
def create_model(body: AdminCreateModel, admin: Admin = Depends(get_current_admin), db: Session = Depends(get_db)) -> dict:
    if db.query(Model).filter(Model.model_key == body.model_key).first():
        raise HTTPException(400, "model_key_exists")
    m = Model(
        model_key=body.model_key, display_name=body.display_name, provider=body.provider,
        upstream_url=body.upstream_url, upstream_model=body.upstream_model,
        api_key_enc=encrypt(body.api_key), credit_rate=body.credit_rate,
        context_window=body.context_window, supports_tools=body.supports_tools,
        supports_stream=body.supports_stream,
    )
    db.add(m)
    db.commit()
    return {"id": m.id, "model_key": m.model_key}


@router.patch("/models/{mid}")
def patch_model(mid: int, body: AdminPatchModel, admin: Admin = Depends(get_current_admin), db: Session = Depends(get_db)) -> dict:
    m = db.get(Model, mid)
    if not m:
        raise HTTPException(404, "not_found")
    if body.display_name is not None: m.display_name = body.display_name
    if body.upstream_url is not None: m.upstream_url = body.upstream_url
    if body.upstream_model is not None: m.upstream_model = body.upstream_model
    if body.api_key: m.api_key_enc = encrypt(body.api_key)
    if body.credit_rate is not None: m.credit_rate = body.credit_rate
    if body.context_window is not None: m.context_window = body.context_window
    if body.supports_tools is not None: m.supports_tools = body.supports_tools
    if body.supports_stream is not None: m.supports_stream = body.supports_stream
    if body.enabled is not None: m.enabled = body.enabled
    if body.sort_order is not None: m.sort_order = body.sort_order
    db.commit()
    return {"ok": True}


@router.delete("/models/{mid}")
def delete_model(mid: int, admin: Admin = Depends(get_current_admin), db: Session = Depends(get_db)) -> dict:
    m = db.get(Model, mid)
    if not m:
        raise HTTPException(404, "not_found")
    db.delete(m)
    db.commit()
    return {"ok": True}


# ---------------- Stats ----------------

@router.get("/stats/overview")
def stats_overview(admin: Admin = Depends(get_current_admin), db: Session = Depends(get_db)) -> dict:
    total_users = db.query(func.count(User.id)).filter(User.status != "deleted").scalar() or 0
    active_users = db.query(func.count(User.id)).filter(User.status == "active").scalar() or 0
    day_ago = datetime.utcnow() - timedelta(days=1)
    week_ago = datetime.utcnow() - timedelta(days=7)
    today_credits = db.query(func.coalesce(func.sum(UsageLog.credits_charged), 0)).filter(UsageLog.created_at >= day_ago).scalar() or 0
    week_credits = db.query(func.coalesce(func.sum(UsageLog.credits_charged), 0)).filter(UsageLog.created_at >= week_ago).scalar() or 0
    total_models = db.query(func.count(Model.id)).scalar() or 0
    enabled_models = db.query(func.count(Model.id)).filter(Model.enabled.is_(True)).scalar() or 0
    total_calls = db.query(func.count(UsageLog.id)).scalar() or 0
    today_calls = db.query(func.count(UsageLog.id)).filter(UsageLog.created_at >= day_ago).scalar() or 0
    total_tokens = db.query(func.coalesce(func.sum(UsageLog.total_tokens), 0)).scalar() or 0
    total_convs = db.query(func.count(Conversation.id)).scalar() or 0
    total_credits_balance = db.query(func.coalesce(func.sum(User.credits), 0)).filter(User.status != "deleted").scalar() or 0
    err_calls = db.query(func.count(UsageLog.id)).filter(UsageLog.status == "error").scalar() or 0
    return {
        "total_users": total_users,
        "active_users": active_users,
        "total_models": total_models,
        "enabled_models": enabled_models,
        "credits_consumed_24h": int(today_credits),
        "credits_consumed_7d": int(week_credits),
        "total_calls": total_calls,
        "calls_24h": today_calls,
        "total_tokens": int(total_tokens),
        "total_conversations": total_convs,
        "total_credits_balance": int(total_credits_balance),
        "error_calls": err_calls,
    }


@router.get("/stats/trend")
def stats_trend(days: int = 7, admin: Admin = Depends(get_current_admin), db: Session = Depends(get_db)) -> dict:
    """最近 N 天每日调用次数 + 积分消耗。"""
    out = []
    for i in range(days - 1, -1, -1):
        day_start = (datetime.utcnow() - timedelta(days=i)).replace(hour=0, minute=0, second=0, microsecond=0)
        day_end = day_start + timedelta(days=1)
        calls = db.query(func.count(UsageLog.id)).filter(UsageLog.created_at >= day_start, UsageLog.created_at < day_end).scalar() or 0
        credits = db.query(func.coalesce(func.sum(UsageLog.credits_charged), 0)).filter(UsageLog.created_at >= day_start, UsageLog.created_at < day_end).scalar() or 0
        out.append({"date": day_start.strftime("%m-%d"), "calls": calls, "credits": int(credits)})
    return {"items": out}


@router.get("/stats/top-users")
def stats_top_users(limit: int = 5, admin: Admin = Depends(get_current_admin), db: Session = Depends(get_db)) -> dict:
    week_ago = datetime.utcnow() - timedelta(days=7)
    rows = (
        db.query(User.username, func.coalesce(func.sum(UsageLog.credits_charged), 0).label("c"))
        .join(UsageLog, UsageLog.user_id == User.id)
        .filter(UsageLog.created_at >= week_ago)
        .group_by(User.id)
        .order_by(func.sum(UsageLog.credits_charged).desc())
        .limit(limit)
        .all()
    )
    return {"items": [{"username": r[0], "credits": int(r[1])} for r in rows]}


# ---------------- Admin profile / account ----------------

@router.get("/me")
def admin_me(admin: Admin = Depends(get_current_admin)) -> dict:
    return {
        "id": admin.id, "username": admin.username, "display_name": admin.display_name,
        "email": admin.email, "role": admin.role, "last_login_at": admin.last_login_at,
        "created_at": admin.created_at,
    }


@router.patch("/me")
def admin_update_me(payload: dict, admin: Admin = Depends(get_current_admin), db: Session = Depends(get_db)) -> dict:
    if "display_name" in payload and payload["display_name"] is not None:
        admin.display_name = payload["display_name"][:64]
    if "email" in payload:
        admin.email = payload["email"]
    db.commit()
    return {"ok": True}


@router.post("/me/change-password")
def admin_change_pw(payload: dict, admin: Admin = Depends(get_current_admin), db: Session = Depends(get_db)) -> dict:
    from ..core.security import verify_password
    old = payload.get("old_password", "")
    new = payload.get("new_password", "")
    if not verify_password(old, admin.password_hash):
        raise HTTPException(400, "invalid_old_password")
    if len(new) < 6:
        raise HTTPException(400, "password_too_short")
    admin.password_hash = hash_password(new)
    db.commit()
    return {"ok": True}
