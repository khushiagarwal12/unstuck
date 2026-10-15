"""Verify the Firebase ID token and return the user's uid (ARCHITECTURE.md section 7)."""

from __future__ import annotations

from dataclasses import dataclass

from fastapi import Depends, Header

from .config import Settings, get_settings
from .errors import AppError
from .firebase_app import ensure_firebase


@dataclass(frozen=True)
class User:
    uid: str


def _bearer(authorization: str | None) -> str:
    if not authorization or not authorization.lower().startswith("bearer "):
        raise AppError("unauthenticated", "Sign-in is required.", status=401)
    return authorization[7:].strip()


async def current_user(
    authorization: str | None = Header(default=None),
    settings: Settings = Depends(get_settings),
) -> User:
    token = _bearer(authorization)

    ensure_firebase(settings)
    from firebase_admin import auth

    try:
        decoded = auth.verify_id_token(token)
    except Exception:
        raise AppError("unauthenticated", "Your session expired. Reload the page.", status=401)
    return User(uid=decoded["uid"])
