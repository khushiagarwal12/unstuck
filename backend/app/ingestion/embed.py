"""Vector embedding and compact serialization (ARCHITECTURE.md section 5.3).

Converts chunks into dense embeddings via LLMClient, serializing to
float16 row-major bytes to fit easily inside Firestore document limits (< 1 MiB).
"""

from __future__ import annotations

import logging
from typing import Sequence

import numpy as np

from ..llm.client import BaseLLM
from .chunk import TextChunk

log = logging.getLogger("unstuck.embed")


async def embed_chunks(
    chunks: Sequence[TextChunk],
    llm: BaseLLM,
) -> tuple[bytes, list[str], int]:
    """Batch embed chunks and return (float16_bytes, chunk_ids, dimension)."""
    if not chunks:
        return b"", [], 0

    texts = [c.text for c in chunks]
    chunk_ids = [c.id for c in chunks]

    # Batch embedding via LLMClient
    raw_embeddings = await llm.embed(texts)
    arr = np.array(raw_embeddings, dtype=np.float16)
    dim = int(arr.shape[1]) if arr.ndim > 1 else 0

    # Ensure contiguous row-major bytes
    return arr.tobytes(), chunk_ids, dim


def deserialize_vectors(vectors_bytes: bytes, count: int, dim: int) -> np.ndarray:
    """Reconstruct numpy float16 matrix from bytes."""
    if not vectors_bytes or count == 0 or dim == 0:
        return np.zeros((0, dim), dtype=np.float16)
    return np.frombuffer(vectors_bytes, dtype=np.float16).reshape((count, dim))
