"""Pydantic schemas (request/response bodies)."""
from __future__ import annotations

from datetime import datetime

from pydantic import BaseModel, ConfigDict, Field


# --------------- Auth ---------------

class LoginRequest(BaseModel):
    username: str
    password: str


class TokenPair(BaseModel):
    access_token: str
    refresh_token: str
    expires_in: int


class RefreshRequest(BaseModel):
    refresh_token: str


class AccessTokenOnly(BaseModel):
    access_token: str
    expires_in: int


# --------------- User ---------------

class UserPublic(BaseModel):
    """Public-safe user payload."""
    model_config = ConfigDict(from_attributes=True)

    id: int
    username: str
    display_name: str | None = None
    email: str | None = None
    credits: int
    token_residual: float = 0.0
    status: str
    expires_at: datetime | None = None


class LoginResponse(TokenPair):
    user: UserPublic


class ChangePasswordRequest(BaseModel):
    old_password: str
    new_password: str = Field(min_length=6, max_length=128)


# --------------- Model ---------------

class ModelPublic(BaseModel):
    model_config = ConfigDict(from_attributes=True)

    model_key: str
    display_name: str
    credit_rate: float
    supports_tools: bool
    supports_stream: bool


class MeResponse(UserPublic):
    models: list[ModelPublic] = []


# --------------- Admin: User CRUD ---------------

class AdminCreateUser(BaseModel):
    username: str
    password: str = Field(min_length=6)
    display_name: str | None = None
    email: str | None = None
    phone: str | None = None
    initial_credits: int = 0
    expires_at: datetime | None = None
    model_keys: list[str] = []


class AdminPatchUser(BaseModel):
    display_name: str | None = None
    email: str | None = None
    phone: str | None = None
    new_password: str | None = Field(default=None, min_length=6)
    status: str | None = None
    expires_at: datetime | None = None
    notes: str | None = None
    model_keys: list[str] | None = None


class AdminRechargeRequest(BaseModel):
    delta: int = Field(description="正数=充值，负数=扣减")
    note: str | None = None


# --------------- Admin: Model CRUD ---------------

class AdminCreateModel(BaseModel):
    model_key: str
    display_name: str
    provider: str
    upstream_url: str
    upstream_model: str
    api_key: str
    credit_rate: float = 1.0
    context_window: int | None = None
    supports_tools: bool = True
    supports_stream: bool = True


class AdminPatchModel(BaseModel):
    display_name: str | None = None
    upstream_url: str | None = None
    upstream_model: str | None = None
    api_key: str | None = None
    credit_rate: float | None = None
    context_window: int | None = None
    supports_tools: bool | None = None
    supports_stream: bool | None = None
    enabled: bool | None = None
    sort_order: int | None = None
