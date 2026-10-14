"""Daily usage limits (ARCHITECTURE.md section 10): per-user caps, a global budget, a judge code."""

from __future__ import annotations

import hmac
from datetime import datetime, timezone
from typing import Callable, Literal

from .config import Settings
from .errors import AppError
from .storage.base import Store

Kind = Literal["llm_calls", "uploads"]
LABEL = {"llm_calls": "tutor requests", "uploads": "uploads"}


def utc_today() -> str:
    return datetime.now(timezone.utc).strftime("%Y-%m-%d")


def is_judge(settings: Settings, code: str | None) -> bool:
    return bool(settings.judge_code) and code is not None and hmac.compare_digest(code, settings.judge_code)


class UsageGuard:
    def __init__(self, store: Store, settings: Settings, *, today: Callable[[], str] = utc_today):
        self._store, self._s, self._today = store, settings, today

    def cap(self, kind: Kind, *, judge: bool = False) -> int:
        base = self._s.daily_uploads_per_user if kind == "uploads" else self._s.daily_llm_calls_per_user
        return base * (self._s.judge_cap_multiplier if judge else 1)

    def _user_path(self, uid: str) -> str:
        return f"usage/{uid}_{self._today()}"

    def _global_path(self) -> str:
        return f"usage/global_{self._today()}"

    async def charge(self, uid: str, kind: Kind, *, judge: bool = False, amount: int = 1) -> None:
        """Raise a clear, retry-later error when a limit is reached; otherwise record the usage."""
        used = int((await self._store.get(self._user_path(uid)) or {}).get(kind, 0))
        if used + amount > self.cap(kind, judge=judge):
            raise AppError(
                "quota_exceeded",
                f"You've used all of today's {LABEL[kind]}. Your allowance resets tomorrow.",
                status=429,
            )
        if kind == "llm_calls":
            g = int((await self._store.get(self._global_path()) or {}).get("llm_calls", 0))
            if g + amount > self._s.daily_llm_calls_global:
                raise AppError(
                    "sample_only",
                    "The tutor has reached its daily limit for everyone. The sample notes still work.",
                    status=429,
                )
        await self._store.increment(self._user_path(uid), kind, amount)
        if kind == "llm_calls":
            await self._store.increment(self._global_path(), "llm_calls", amount)

    async def snapshot(self, uid: str, *, judge: bool = False) -> dict:
        doc = await self._store.get(self._user_path(uid)) or {}
        g = int((await self._store.get(self._global_path()) or {}).get("llm_calls", 0))
        return {
            kind: {"used": int(doc.get(kind, 0)), "cap": self.cap(kind, judge=judge)}
            for kind in ("llm_calls", "uploads")
        } | {"sample_only": g >= self._s.daily_llm_calls_global}
