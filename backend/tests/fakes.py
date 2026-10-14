"""Test doubles. These exist only for unit tests and are never imported by application code."""

from __future__ import annotations

import asyncio
import copy
import json

from pydantic import BaseModel

from app.llm.client import BaseLLM


class ScriptedLLM(BaseLLM):
    """Returns queued JSON replies so tests can drive the real validation, retry and limit logic."""

    def __init__(self, *, timeout: float = 5.0, rpm_main: int = 1000, rpm_fast: int = 1000):
        super().__init__(timeout=timeout, rpm_main=rpm_main, rpm_fast=rpm_fast)
        self._replies: list[str] = []
        self.calls: list[dict] = []

    def queue(self, *replies) -> "ScriptedLLM":
        for r in replies:
            if isinstance(r, BaseModel):
                r = r.model_dump_json()
            elif isinstance(r, (dict, list)):
                r = json.dumps(r)
            self._replies.append(r)
        return self

    async def _generate_json(self, *, prompt, system, tier, schema) -> str:
        self.calls.append({"prompt": prompt, "system": system, "tier": tier, "schema": schema.__name__})
        if not self._replies:
            raise RuntimeError("ScriptedLLM has no queued reply")
        return self._replies.pop(0)

    async def _embed(self, texts, query=False):
        # Deterministic bag-of-letters vector: similar texts land close together.
        out = []
        for t in texts:
            v = [0.0] * 26
            for ch in t.lower():
                if "a" <= ch <= "z":
                    v[ord(ch) - 97] += 1.0
            out.append(v)
        return out


class MemoryStore:
    """In-memory Store for tests."""

    def __init__(self) -> None:
        self._docs: dict[str, dict] = {}
        self._lock = asyncio.Lock()

    async def get(self, path):
        async with self._lock:
            d = self._docs.get(path)
            return copy.deepcopy(d) if d is not None else None

    async def set(self, path, data):
        async with self._lock:
            self._docs[path] = copy.deepcopy(data)

    async def merge(self, path, data):
        async with self._lock:
            self._docs.setdefault(path, {}).update(copy.deepcopy(data))

    async def increment(self, path, field, by=1):
        async with self._lock:
            d = self._docs.setdefault(path, {})
            d[field] = int(d.get(field, 0)) + by
            return d[field]

    async def delete(self, path):
        async with self._lock:
            self._docs.pop(path, None)

    def paths(self, prefix: str = "") -> list[str]:
        return sorted(p for p in self._docs if p.startswith(prefix))
