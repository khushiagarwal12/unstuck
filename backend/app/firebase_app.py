"""One place that initialises the Firebase Admin SDK (used by auth and by the Firestore store)."""

from __future__ import annotations

import json

import firebase_admin
from firebase_admin import credentials

from .config import Settings
from .errors import AppError


def ensure_firebase(settings: Settings) -> None:
    try:
        firebase_admin.get_app()
        return
    except ValueError:
        pass  # not initialised yet
    if not settings.firebase_service_account_json:
        raise AppError("auth_not_configured", "The server is missing its Firebase configuration.", status=503)
    try:
        cred = credentials.Certificate(json.loads(settings.firebase_service_account_json))
    except Exception:  # never echo the key material
        raise AppError("auth_not_configured", "The Firebase configuration is invalid.", status=503)
    firebase_admin.initialize_app(cred)
