"""Verify the Firebase ID token and return the user's uid (ARCHITECTURE.md section 7)."""

from __future__ import annotations

import json
from dataclasses import dataclass

from fastapi import Depends, Header

from .config import Settings, get_settings
from .errors import AppError

_firebase_ready = False


@dataclass(frozen=True)
class User:
    uid: str


def _init_firebase(settings: Settings) -> None:
    global _firebase_ready
    if _firebase_ready:
        return
    if not settings.firebase_service_account_json:
        raise AppError(
            "auth_not_configured",
            "The server is missing its Firebase configuration.",
            status=503,
        )
    import firebase_admin
    from firebase_admin import credentials

    cred = credentials.Certificate(json.loads(settings.firebase_service_account_json))
    firebase_admin.initialize_app(cred)
    _firebase_ready = True


def _bearer(authorization: str | None) -> str:
    if not authorization or not authorization.lower().startswith("bearer "):
        raise AppError("unauthenticated", "Sign-in is required.", status=401)
    return authorization[7:].strip()


async def current_user(
    authorization: str | None = Header(default=None),
    settings: Settings = Depends(get_settings),
) -> User:
    token = _bearer(authorization)

    if settings.auth_mode == "dev":
        if not token.startswith("dev-") or len(token) <= 4:
            raise AppError("unauthenticated", "Invalid development token.", status=401)
        return User(uid=token[4:])

    _init_firebase(settings)
    from firebase_admin import auth

    try:
        decoded = auth.verify_id_token(token)
    except Exception:
        raise AppError("unauthenticated", "Your session expired. Reload the page.", status=401)
    return User(uid=decoded["uid"])
