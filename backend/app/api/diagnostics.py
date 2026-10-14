"""Day 1 end-to-end check: signed-in call, model call with structured output, and a stored write."""

from __future__ import annotations

from datetime import datetime, timezone

from fastapi import APIRouter, Depends
from pydantic import BaseModel

from ..auth import User, current_user
from ..config import Settings, get_settings
from ..deps import get_llm, get_store, get_usage, judge_flag
from ..errors import AppError
from ..llm.client import BaseLLM
from ..storage.base import Store
from ..usage import UsageGuard

router = APIRouter(prefix="/api/diagnostics", tags=["diagnostics"])


class Pong(BaseModel):
    message: str


@router.post("/roundtrip")
async def roundtrip(
    user: User = Depends(current_user),
    settings: Settings = Depends(get_settings),
    llm: BaseLLM = Depends(get_llm),
    store: Store = Depends(get_store),
    usage: UsageGuard = Depends(get_usage),
    judge: bool = Depends(judge_flag),
) -> dict:
    if not settings.enable_diagnostics:
        raise AppError("not_found", "Not found.", status=404)
    await usage.charge(user.uid, "llm_calls", judge=judge)
    pong = await llm.generate_structured(
        prompt='Reply with exactly this JSON and nothing else: {"message": "pong"}',
        schema=Pong,
        tier="fast",
    )
    path = f"diagnostics/{user.uid}"
    await store.set(path, {"message": pong.message, "at": datetime.now(timezone.utc).isoformat()})
    saved = await store.get(path)
    return {"uid": user.uid, "model_reply": pong.message, "stored": bool(saved and saved.get("message") == pong.message)}
