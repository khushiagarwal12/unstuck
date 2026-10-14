"""Shared FastAPI dependencies. Tests replace these through app.dependency_overrides."""

from __future__ import annotations

from functools import lru_cache

from fastapi import Depends, Header

from .config import Settings, get_settings
from .llm.client import BaseLLM, build_llm
from .storage.base import Store
from .storage.firestore_store import FirestoreStore
from .usage import UsageGuard, is_judge


@lru_cache
def _llm() -> BaseLLM:
    return build_llm(get_settings())


@lru_cache
def _store() -> Store:
    s = get_settings()
    return FirestoreStore(s)


def get_llm() -> BaseLLM:
    return _llm()


def get_store() -> Store:
    return _store()


def get_usage(store: Store = Depends(get_store), settings: Settings = Depends(get_settings)) -> UsageGuard:
    return UsageGuard(store, settings)


def judge_flag(
    x_judge_code: str | None = Header(default=None),
    settings: Settings = Depends(get_settings),
) -> bool:
    return is_judge(settings, x_judge_code)
