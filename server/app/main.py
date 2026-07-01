"""Application entrypoint."""
from __future__ import annotations

from fastapi import FastAPI
from fastapi.middleware.cors import CORSMiddleware

from .core.config import get_settings
from .core.db import Base, engine
from .routers import admin, admin_auth, auth, conversations, llm, me

settings = get_settings()

# Auto-create tables on startup (replace with Alembic when schema stabilizes).
Base.metadata.create_all(bind=engine)

app = FastAPI(title=settings.project_name, debug=settings.debug)

app.add_middleware(
    CORSMiddleware,
    allow_origins=settings.cors_origins,
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)


@app.get("/health", tags=["meta"])
def health() -> dict:
    return {"status": "ok"}


app.include_router(auth.router)
app.include_router(me.router)
app.include_router(conversations.router)
app.include_router(llm.router)
app.include_router(admin_auth.router)
app.include_router(admin.router)
