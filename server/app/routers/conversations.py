"""Conversation & message persistence for chat history / multi-session."""
from __future__ import annotations

from fastapi import APIRouter, Depends, HTTPException
from sqlalchemy.orm import Session

from ..core.db import get_db
from ..deps import get_current_user
from ..models import Conversation, Message, User

router = APIRouter(prefix="/me/conversations", tags=["conversations"])


def _conv_dict(c: Conversation, with_count: bool = False, db: Session | None = None) -> dict:
    d = {
        "id": c.id, "title": c.title, "model_key": c.model_key,
        "pinned": c.pinned, "created_at": c.created_at, "updated_at": c.updated_at,
    }
    if with_count and db is not None:
        d["message_count"] = db.query(Message).filter(Message.conversation_id == c.id).count()
    return d


def _owned(db: Session, user: User, cid: int) -> Conversation:
    c = db.get(Conversation, cid)
    if not c or c.user_id != user.id:
        raise HTTPException(404, "not_found")
    return c


@router.get("")
def list_conversations(user: User = Depends(get_current_user), db: Session = Depends(get_db)) -> dict:
    rows = (
        db.query(Conversation)
        .filter(Conversation.user_id == user.id)
        .order_by(Conversation.pinned.desc(), Conversation.updated_at.desc())
        .all()
    )
    return {"items": [_conv_dict(c) for c in rows]}


@router.post("")
def create_conversation(payload: dict | None = None, user: User = Depends(get_current_user), db: Session = Depends(get_db)) -> dict:
    payload = payload or {}
    c = Conversation(
        user_id=user.id,
        title=(payload.get("title") or "新对话")[:128],
        model_key=payload.get("model_key"),
    )
    db.add(c)
    db.commit()
    return _conv_dict(c)


@router.get("/{cid}")
def get_conversation(cid: int, user: User = Depends(get_current_user), db: Session = Depends(get_db)) -> dict:
    c = _owned(db, user, cid)
    msgs = (
        db.query(Message)
        .filter(Message.conversation_id == cid)
        .order_by(Message.id)
        .all()
    )
    return {
        **_conv_dict(c),
        "messages": [{"id": m.id, "role": m.role, "content": m.content, "created_at": m.created_at} for m in msgs],
    }


@router.patch("/{cid}")
def patch_conversation(cid: int, payload: dict, user: User = Depends(get_current_user), db: Session = Depends(get_db)) -> dict:
    c = _owned(db, user, cid)
    if "title" in payload and payload["title"]:
        c.title = payload["title"][:128]
    if "model_key" in payload:
        c.model_key = payload["model_key"]
    if "pinned" in payload:
        c.pinned = bool(payload["pinned"])
    db.commit()
    return _conv_dict(c)


@router.delete("/{cid}")
def delete_conversation(cid: int, user: User = Depends(get_current_user), db: Session = Depends(get_db)) -> dict:
    c = _owned(db, user, cid)
    db.delete(c)
    db.commit()
    return {"ok": True}


@router.post("/{cid}/messages")
def append_messages(cid: int, payload: dict, user: User = Depends(get_current_user), db: Session = Depends(get_db)) -> dict:
    """批量追加消息（前端在一轮对话结束后保存 user+assistant 两条）。"""
    c = _owned(db, user, cid)
    items = payload.get("messages", [])
    added = []
    for it in items:
        role = it.get("role")
        content = it.get("content", "")
        if role not in ("user", "assistant", "system"):
            continue
        m = Message(conversation_id=cid, role=role, content=content, tokens=it.get("tokens"))
        db.add(m)
        added.append(m)
    # 首条用户消息自动作为标题
    if c.title in ("新对话", "") and items:
        first_user = next((i for i in items if i.get("role") == "user"), None)
        if first_user:
            c.title = first_user["content"][:30]
    db.commit()
    return {"ok": True, "added": len(added)}
