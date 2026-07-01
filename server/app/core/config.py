"""Application configuration loaded from environment variables."""
from __future__ import annotations

import secrets
from functools import lru_cache
from pathlib import Path

from pydantic import Field
from pydantic_settings import BaseSettings, SettingsConfigDict


class Settings(BaseSettings):
    """Runtime settings for the YT API server."""

    # --- Project basics ---
    project_name: str = "异想天开 API"
    api_v1_prefix: str = "/yt-api"
    debug: bool = False

    # --- Security ---
    jwt_secret: str = Field(default_factory=lambda: secrets.token_urlsafe(48))
    jwt_algorithm: str = "HS256"
    access_token_ttl_minutes: int = 60
    refresh_token_ttl_days: int = 30

    # Fernet key used to encrypt upstream LLM API keys at rest.
    master_key: str = Field(
        default_factory=lambda: "CHANGE_ME_RUN_python -c 'from cryptography.fernet import Fernet;print(Fernet.generate_key().decode())'"
    )

    # --- Database ---
    db_url: str = "sqlite:///./yt.db"

    # --- CORS / Hosts ---
    cors_origins: list[str] = ["*"]

    model_config = SettingsConfigDict(
        env_file=".env",
        env_prefix="YT_",
        env_file_encoding="utf-8",
        extra="ignore",
    )


@lru_cache
def get_settings() -> Settings:
    """Cached settings instance."""
    return Settings()


# Project root path helper (server/)
PROJECT_ROOT = Path(__file__).resolve().parents[2]
