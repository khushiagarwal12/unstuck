from __future__ import annotations

import asyncio
import logging
from typing import Callable, TypeVar

from ..config import Settings
from ..errors import AppError
from ..firebase_app import ensure_firebase
from .base import Doc

log = logging.getLogger("unstuck.store")
T = TypeVar("T")


class FirestoreStore:
    """Firestore via the Admin SDK (Spark plan). The SDK is synchronous, so calls run in a thread.

    NOTE: written against the documented firebase-admin API; not yet exercised against a real
    project (needs the Day 0 service-account key). `increment` is not one atomic read-modify-write:
    it is accurate enough for daily caps, not for money.
    """

    def __init__(self, settings: Settings):
        ensure_firebase(settings)
        from firebase_admin import firestore

        self._fs = firestore
        self._db = firestore.client()

    async def _run(self, fn: Callable[[], T]) -> T:
        try:
            return await asyncio.to_thread(fn)
        except AppError:
            raise
        except Exception as exc:  # never leak provider details or document content
            log.error("firestore_error type=%s", type(exc).__name__)
            raise AppError("storage_unavailable", "Saving is unavailable right now. Try again.", status=503, retryable=True)

    async def get(self, path: str) -> Doc | None:
        snap = await self._run(lambda: self._db.document(path).get())
        return snap.to_dict() if snap.exists else None

    async def set(self, path: str, data: Doc) -> None:
        await self._run(lambda: self._db.document(path).set(data))

    async def merge(self, path: str, data: Doc) -> None:
        await self._run(lambda: self._db.document(path).set(data, merge=True))

    async def increment(self, path: str, field: str, by: int = 1) -> int:
        def _do() -> int:
            ref = self._db.document(path)
            ref.set({field: self._fs.Increment(by)}, merge=True)
            return int((ref.get().to_dict() or {}).get(field, 0))

        return await self._run(_do)

    async def delete(self, path: str) -> None:
        await self._run(lambda: self._db.document(path).delete())
