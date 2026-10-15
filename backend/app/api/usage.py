"""Usage and quota endpoints (ARCHITECTURE.md section 7 & 10).

Returns remaining daily quota for uploads and LLM calls for the authenticated user.
"""

from __future__ import annotations

import datetime

from fastapi import APIRouter, Depends

from ..auth import User, current_user
from ..config import Settings, get_settings
from ..storage.firestore import Database, get_db

router = APIRouter(prefix="/api/usage", tags=["usage"])


def _today_str() -> str:
    return datetime.datetime.now(datetime.timezone.utc).strftime("%Y-%m-%d")


@router.get("")
async def get_usage(
    user: User = Depends(current_user),
    db: Database = Depends(get_db),
    settings: Settings = Depends(get_settings),
):
    """Return remaining daily quota for user."""
    today = _today_str()
    user_record = await db.get_user(user.uid) or {}
    usage = user_record.get("usage", {})

    if usage.get("date") != today:
        uploads_used = 0
        llm_used = 0
    else:
        uploads_used = usage.get("uploads", 0)
        llm_used = usage.get("llmCalls", 0)

    return {
        "date": today,
        "uploadsRemaining": max(0, settings.daily_uploads_per_user - uploads_used),
        "uploadsMax": settings.daily_uploads_per_user,
        "llmCallsRemaining": max(0, settings.daily_llm_calls_per_user - llm_used),
        "llmCallsMax": settings.daily_llm_calls_per_user,
    }
