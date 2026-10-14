"""The storage interface. Free tier today is Firestore (Spark); everything else stays behind this."""

from __future__ import annotations

from typing import Any, Protocol

Doc = dict[str, Any]


class Store(Protocol):
    """Documents are addressed by slash paths such as 'users/abc' or 'usage/abc_2026-10-14'."""

    async def get(self, path: str) -> Doc | None: ...
    async def set(self, path: str, data: Doc) -> None: ...
    async def merge(self, path: str, data: Doc) -> None: ...
    async def increment(self, path: str, field: str, by: int = 1) -> int:
        """Add `by` to a numeric field (creating it) and return the new value."""
        ...
    async def delete(self, path: str) -> None: ...
