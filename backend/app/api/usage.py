from __future__ import annotations

from fastapi import APIRouter, Depends

from ..auth import User, current_user
from ..deps import get_usage, judge_flag
from ..usage import UsageGuard

router = APIRouter(prefix="/api", tags=["usage"])


@router.get("/usage")
async def my_usage(
    user: User = Depends(current_user),
    usage: UsageGuard = Depends(get_usage),
    judge: bool = Depends(judge_flag),
) -> dict:
    """Remaining daily allowance, so the UI can warn before a limit is hit."""
    return await usage.snapshot(user.uid, judge=judge)
