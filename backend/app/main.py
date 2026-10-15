"""UNSTUCK API entry point."""

from __future__ import annotations

import logging

from fastapi import Depends, FastAPI
from fastapi.middleware.cors import CORSMiddleware

from .api.courses import router as courses_router
from .api.documents import router as documents_router
from .api.progress import router as progress_router
from .api.sessions import router as sessions_router
from .api.usage import router as usage_router
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
        allow_methods=["GET", "POST", "DELETE", "OPTIONS"],
        allow_headers=["Authorization", "Content-Type"],
    )
    install_error_handlers(app)

    app.include_router(documents_router)
    app.include_router(sessions_router)
    app.include_router(progress_router)
    app.include_router(usage_router)
    app.include_router(courses_router)

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
