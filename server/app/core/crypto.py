"""Fernet encryption for upstream API keys."""
from __future__ import annotations

from cryptography.fernet import Fernet

from .config import get_settings

settings = get_settings()


def _fernet() -> Fernet:
    key = settings.master_key
    if not key or key.startswith("CHANGE_ME"):
        raise RuntimeError("YT_MASTER_KEY 未配置，无法加解密上游 API Key")
    return Fernet(key.encode() if isinstance(key, str) else key)


def encrypt(plain: str) -> str:
    return _fernet().encrypt(plain.encode("utf-8")).decode("utf-8")


def decrypt(token: str) -> str:
    return _fernet().decrypt(token.encode("utf-8")).decode("utf-8")
