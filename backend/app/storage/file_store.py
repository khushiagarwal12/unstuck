"""File store interface and adapters (ARCHITECTURE.md section 11).

Today: MemoryFileStore (ephemeral, no persistent original files on free tier).
Credits-ready: CloudStorageFileStore for Cloud Storage.
"""

from __future__ import annotations

from typing import Protocol


class FileStore(Protocol):
    async def save(self, path: str, data: bytes, content_type: str = "application/octet-stream") -> str:
        """Save a file and return its URI."""
        ...

    async def get(self, path: str) -> bytes | None:
        """Retrieve file bytes or None if not found."""
        ...

    async def delete(self, path: str) -> bool:
        """Delete file. Returns True if deleted."""
        ...


class MemoryFileStore:
    """Ephemeral in-memory store for free-tier operation."""

    def __init__(self) -> None:
        self._files: dict[str, tuple[bytes, str]] = {}

    async def save(self, path: str, data: bytes, content_type: str = "application/octet-stream") -> str:
        self._files[path] = (data, content_type)
        return f"memory://{path}"

    async def get(self, path: str) -> bytes | None:
        item = self._files.get(path)
        return item[0] if item else None

    async def delete(self, path: str) -> bool:
        return self._files.pop(path, None) is not None


_default_file_store: FileStore = MemoryFileStore()


def get_file_store() -> FileStore:
    return _default_file_store
