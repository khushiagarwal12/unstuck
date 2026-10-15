"""UNSTUCK API entry point."""

from __future__ import annotations

import logging

from fastapi import Depends, FastAPI
from fastapi.middleware.cors import CORSMiddleware

from .api.courses import router as courses_router
from .api.diagnostics import router as diagnostics_router
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
    app.include_router(diagnostics_router)

    @app.get("/health", response_model=HealthResponse)
    async def health(s: Settings = Depends(get_settings)) -> HealthResponse:
        """Warm-up endpoint: the frontend calls this on load, no auth."""
        return HealthResponse(ok=True, version=s.app_version)

    @app.get("/api/me")
    async def me(user: User = Depends(current_user)) -> dict:
        """Confirms the sign-in round trip end to end (Day 1 exit check)."""
        return {"uid": user.uid}

    import os
    from fastapi.staticfiles import StaticFiles
    from fastapi.responses import FileResponse

    static_dir = os.path.abspath(os.path.join(os.path.dirname(__file__), "..", "static"))
    if os.path.isdir(static_dir):
        assets_dir = os.path.join(static_dir, "assets")
        if os.path.isdir(assets_dir):
            app.mount("/assets", StaticFiles(directory=assets_dir), name="assets")

        @app.get("/{full_path:path}")
        async def serve_spa(full_path: str):
            if full_path.startswith("api/") or full_path == "health":
                from .errors import AppError
                raise AppError("not_found", "Endpoint not found", status=404)
            file_path = os.path.join(static_dir, full_path)
            if os.path.isfile(file_path):
                return FileResponse(file_path)
            index_path = os.path.join(static_dir, "index.html")
            if os.path.isfile(index_path):
                return FileResponse(index_path)
            from .errors import AppError
            raise AppError("not_found", "Not found", status=404)

    return app


app = create_app()
