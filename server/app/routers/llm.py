"""OpenAI-compatible LLM proxy: /v1/models and /v1/chat/completions.

鉴权 → 校验模型授权 → 校验积分 → 转发上游 → 计费扣分 + 写日志。
"""
from __future__ import annotations

import json
import math
import time
from typing import Any

import httpx
from fastapi import APIRouter, Depends, HTTPException, Request, status
from fastapi.responses import JSONResponse, StreamingResponse
from sqlalchemy.orm import Session

from ..core.crypto import decrypt
from ..core.db import get_db
from ..deps import get_current_user
from ..models import CreditLog, Model, UsageLog, User, UserModel

router = APIRouter(prefix="/v1", tags=["llm"])


def _authorized_model(db: Session, user: User, model_key: str) -> Model:
    model = (
        db.query(Model)
        .join(UserModel, UserModel.model_id == Model.id)
        .filter(
            UserModel.user_id == user.id,
            Model.model_key == model_key,
            Model.enabled.is_(True),
        )
        .first()
    )
    if not model:
        raise HTTPException(
            status_code=status.HTTP_403_FORBIDDEN,
            detail="model_not_authorized",
        )
    return model


def _charge(db: Session, user: User, model: Model, usage: dict[str, Any], request_id: str | None,
            status_str: str, latency_ms: int, client_ip: str | None, err: str | None = None) -> int:
    """累计计费：每次的 token×rate 累加到余量池，每满 1000 手下扣 1 分。
    不足 1000 不扣，不向上取整，余量跨请求/跨对话累加。"""
    prompt = int(usage.get("prompt_tokens", 0) or 0)
    completion = int(usage.get("completion_tokens", 0) or 0)
    total = int(usage.get("total_tokens", prompt + completion) or 0)

    # 本次等效 token（已乘计费倍率）累加进余量池
    residual = float(user.token_residual or 0.0) + total * float(model.credit_rate)
    credits = int(residual // 1000)          # 满 1000 才扣，向下取整
    user.token_residual = residual - credits * 1000  # 保留未满余量

    log = UsageLog(
        user_id=user.id, model_id=model.id, request_id=request_id,
        prompt_tokens=prompt, completion_tokens=completion, total_tokens=total,
        credits_charged=credits, status=status_str, error_message=err,
        latency_ms=latency_ms, client_ip=client_ip,
    )
    db.add(log)
    db.flush()

    if credits > 0:
        user.credits = max(0, user.credits - credits)
        db.add(CreditLog(
            user_id=user.id, delta=-credits, balance_after=user.credits,
            reason="usage", related_id=log.id,
        ))
    db.add(user)
    db.commit()
    return credits


@router.get("/models")
def list_models(user: User = Depends(get_current_user), db: Session = Depends(get_db)) -> dict:
    rows = (
        db.query(Model)
        .join(UserModel, UserModel.model_id == Model.id)
        .filter(UserModel.user_id == user.id, Model.enabled.is_(True))
        .order_by(Model.sort_order, Model.id)
        .all()
    )
    return {
        "object": "list",
        "data": [
            {"id": m.model_key, "object": "model", "owned_by": "yixiang-tiankai"}
            for m in rows
        ],
    }


@router.post("/chat/completions")
async def chat_completions(
    request: Request,
    user: User = Depends(get_current_user),
    db: Session = Depends(get_db),
):
    body = await request.json()
    model_key = body.get("model")
    if not model_key:
        raise HTTPException(status_code=400, detail="missing_model")

    model = _authorized_model(db, user, model_key)

    if user.credits <= 0:
        raise HTTPException(status_code=402, detail="insufficient_credits")

    client_ip = request.client.host if request.client else None
    upstream_key = decrypt(model.api_key_enc)
    upstream_body = dict(body)
    upstream_body["model"] = model.upstream_model

    url = model.upstream_url.rstrip("/") + "/chat/completions"
    headers = {
        "Authorization": f"Bearer {upstream_key}",
        "Content-Type": "application/json",
    }
    is_stream = bool(body.get("stream"))
    started = time.time()

    if not is_stream:
        async with httpx.AsyncClient(timeout=300) as client:
            try:
                r = await client.post(url, json=upstream_body, headers=headers)
            except httpx.HTTPError as e:
                _charge(db, user, model, {}, None, "error", int((time.time() - started) * 1000), client_ip, str(e))
                raise HTTPException(status_code=502, detail="upstream_error")
        latency = int((time.time() - started) * 1000)
        data = r.json()
        if r.status_code == 200:
            _charge(db, user, model, data.get("usage", {}), data.get("id"), "success", latency, client_ip)
            # 把对外模型名换回 model_key
            data["model"] = model_key
        else:
            _charge(db, user, model, {}, None, "error", latency, client_ip, json.dumps(data)[:500])
        return JSONResponse(content=data, status_code=r.status_code)

    # ---- 流式 ----
    async def event_stream():
        usage_holder: dict[str, Any] = {}
        req_id_holder: dict[str, str] = {}
        # 强制上游回传 usage
        upstream_body.setdefault("stream_options", {})["include_usage"] = True
        try:
            async with httpx.AsyncClient(timeout=300) as client:
                async with client.stream("POST", url, json=upstream_body, headers=headers) as r:
                    async for line in r.aiter_lines():
                        if not line:
                            continue
                        if line.startswith("data: "):
                            payload = line[6:]
                            if payload.strip() == "[DONE]":
                                yield "data: [DONE]\n\n"
                                continue
                            try:
                                obj = json.loads(payload)
                                if obj.get("usage"):
                                    usage_holder.update(obj["usage"])
                                if obj.get("id"):
                                    req_id_holder["id"] = obj["id"]
                                if obj.get("model"):
                                    obj["model"] = model_key
                                yield f"data: {json.dumps(obj, ensure_ascii=False)}\n\n"
                            except json.JSONDecodeError:
                                yield f"{line}\n\n"
                        else:
                            yield f"{line}\n\n"
        finally:
            latency = int((time.time() - started) * 1000)
            _charge(db, user, model, usage_holder, req_id_holder.get("id"),
                    "success" if usage_holder else "error", latency, client_ip)

    return StreamingResponse(event_stream(), media_type="text/event-stream")
