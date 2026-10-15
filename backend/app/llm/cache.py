"""LLM prompt and generation cache (ARCHITECTURE.md section 8).

Keyed by hash(prompt template + inputs). Avoids redundant LLM calls
for identical documents or catalogs on free-tier quotas.
"""

from __future__ import annotations

import hashlib
import json
from typing import Any, Mapping

_in_memory_cache: dict[str, str] = {}


def compute_cache_key(prefix: str, inputs: Mapping[str, Any]) -> str:
    serialized = json.dumps(inputs, sort_keys=True, default=str)
    digest = hashlib.sha256(serialized.encode("utf-8")).hexdigest()[:24]
    return f"{prefix}:{digest}"


class PromptCache:
    def __init__(self) -> None:
        self._store = _in_memory_cache

    def get(self, key: str) -> str | None:
        return self._store.get(key)

    def set(self, key: str, value: str) -> None:
        self._store[key] = value

    def clear(self) -> None:
        self._store.clear()


prompt_cache = PromptCache()
