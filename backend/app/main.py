"""UNSTUCK API entry point."""

from __future__ import annotations

import logging

from fastapi import Depends, FastAPI
from fastapi.middleware.cors import CORSMiddleware

from .auth import User, current_user
from .config import Settings, get_settings
from .errors import install_error_handlers
from .schemas import HealthResponse

logging.basicConfig(level=logging.INFO, format='{"level":"%(levelname)s","logger":"%(name)s","msg":"%(message)s"}')


def create_app() -> FastAPI:
    settings = get_settings()
    app = FastAPI(title="UNSTUCK API", version=settings.app_version)

    app.add_middleware(
        CORSMiddleware,
        allow_origins=settings.cors_origins,
        allow_methods=["GET", "POST", "DELETE"],
        allow_headers=["Authorization", "Content-Type"],
    )
    install_error_handlers(app)

    @app.get("/health", response_model=HealthResponse)
    async def health(s: Settings = Depends(get_settings)) -> HealthResponse:
        """Warm-up endpoint: the frontend calls this on load, no auth."""
        return HealthResponse(ok=True, version=s.app_version)

    @app.get("/api/me")
    async def me(user: User = Depends(current_user)) -> dict:
        """Confirms the sign-in round trip end to end (Day 1 exit check)."""
        return {"uid": user.uid}

    return app


app = create_app()
