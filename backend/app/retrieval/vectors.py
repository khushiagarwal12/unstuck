"""Compact vector storage and in-memory similarity search (ARCHITECTURE.md section 5.2).

Vectors are L2-normalised, stored as float16 bytes (base64 in Firestore), and searched with a
plain dot product, which is exact and fast for the <=150 chunks a document may have.
"""

from __future__ import annotations

import base64
import re
import unicodedata
from collections import OrderedDict
from dataclasses import dataclass
from typing import Sequence

import numpy as np

from ..errors import AppError


def _normalise(matrix: np.ndarray) -> np.ndarray:
    norms = np.linalg.norm(matrix, axis=1, keepdims=True)
    norms[norms == 0] = 1.0
    return matrix / norms


def encode_vectors(vectors: Sequence[Sequence[float]]) -> dict:
    """Return {"dim": int, "count": int, "data": base64-of-float16} for storage."""
    if not vectors:
        return {"dim": 0, "count": 0, "data": ""}
    arr = np.asarray(vectors, dtype=np.float32)
    if arr.ndim != 2:
        raise ValueError("vectors must all have the same length")
    arr = _normalise(arr).astype(np.float16)
    return {
        "dim": int(arr.shape[1]),
        "count": int(arr.shape[0]),
        "data": base64.b64encode(arr.tobytes()).decode("ascii"),
    }


def decode_vectors(blob: dict) -> np.ndarray:
    dim, count = int(blob["dim"]), int(blob["count"])
    if count == 0:
        return np.zeros((0, 0), dtype=np.float32)
    raw = base64.b64decode(blob["data"])
    arr = np.frombuffer(raw, dtype=np.float16)
    if arr.size != dim * count:
        raise AppError("corrupt_document", "Stored document data is damaged. Upload it again.", status=500)
    return arr.reshape(count, dim).astype(np.float32)


@dataclass(frozen=True)
class Hit:
    chunk_id: str
    score: float


class VectorIndex:
    def __init__(self, chunk_ids: Sequence[str], matrix: np.ndarray):
        if len(chunk_ids) != matrix.shape[0]:
            raise ValueError("one vector per chunk is required")
        self.chunk_ids = list(chunk_ids)
        self.matrix = matrix

    @classmethod
    def from_blob(cls, chunk_ids: Sequence[str], blob: dict) -> "VectorIndex":
        return cls(chunk_ids, decode_vectors(blob))

    def search(self, query: Sequence[float], k: int = 4) -> list[Hit]:
        if not self.chunk_ids:
            return []
        q = np.asarray(query, dtype=np.float32)
        if q.shape[0] != self.matrix.shape[1]:
            raise ValueError("query dimension does not match the index")
        norm = np.linalg.norm(q)
        if norm == 0:
            return []
        scores = self.matrix @ (q / norm)
        order = np.argsort(-scores)[: max(k, 0)]
        return [Hit(self.chunk_ids[i], float(scores[i])) for i in order]


class IndexCache:
    """Small LRU so a busy instance does not re-read vectors from Firestore every request."""

    def __init__(self, capacity: int = 16):
        self.capacity = capacity
        self._items: OrderedDict[str, VectorIndex] = OrderedDict()

    def get(self, key: str) -> VectorIndex | None:
        index = self._items.get(key)
        if index is not None:
            self._items.move_to_end(key)
        return index

    def put(self, key: str, index: VectorIndex) -> None:
        self._items[key] = index
        self._items.move_to_end(key)
        while len(self._items) > self.capacity:
            self._items.popitem(last=False)

    def drop(self, key: str) -> None:
        self._items.pop(key, None)


_WS = re.compile(r"\s+")


def _squash(text: str) -> str:
    return _WS.sub(" ", unicodedata.normalize("NFC", text)).strip().casefold()


def quote_supported(quote: str, chunk_text: str, min_chars: int = 8) -> bool:
    """A citation is valid only if its quote really appears in the chunk it points to."""
    q = _squash(quote)
    return len(q) >= min_chars and q in _squash(chunk_text)
