"""In-memory LRU vector retrieval store (ARCHITECTURE.md section 5.3).

Caches document chunks and float16 embeddings in memory.
Performs fast top-k cosine similarity queries via numpy.
Avoids reading blobs repeatedly from Firestore.
"""

from __future__ import annotations

import collections
import logging
from typing import Sequence

import numpy as np

from ..ingestion.embed import deserialize_vectors
from ..storage.firestore import Database

log = logging.getLogger("unstuck.retrieval")

MAX_CACHED_DOCS = 16
DEFAULT_TOP_K = 4


class DocumentIndex:
    def __init__(self, doc_id: str, chunks: list[dict], vectors: np.ndarray, ids: list[str]) -> None:
        self.doc_id = doc_id
        self.chunks = chunks
        self.chunks_by_id = {c["id"]: c for c in chunks}
        self.vectors = vectors.astype(np.float32)  # upcast for computation
        self.ids = ids

        # Precompute vector norms for cosine similarity
        if self.vectors.size > 0:
            norms = np.linalg.norm(self.vectors, axis=1, keepdims=True)
            norms[norms == 0] = 1.0
            self.normalized_vectors = self.vectors / norms
        else:
            self.normalized_vectors = np.zeros((0, 1), dtype=np.float32)

    def search(self, query_vector: Sequence[float], k: int = DEFAULT_TOP_K) -> list[dict]:
        """Return top-k chunk dicts ranked by cosine similarity."""
        if self.vectors.size == 0 or len(self.chunks) == 0:
            return self.chunks[:k]

        q = np.array(query_vector, dtype=np.float32)
        norm_q = np.linalg.norm(q)
        if norm_q == 0:
            return self.chunks[:k]
        q = q / norm_q

        # Cosine similarity is dot product of normalized vectors
        scores = np.dot(self.normalized_vectors, q)
        top_indices = np.argsort(scores)[::-1][:k]

        return [self.chunks[i] for i in top_indices if i < len(self.chunks)]


class RetrievalStore:
    def __init__(self, capacity: int = MAX_CACHED_DOCS) -> None:
        self.capacity = capacity
        self._cache: collections.OrderedDict[str, DocumentIndex] = collections.OrderedDict()

    async def get_index(self, doc_id: str, db: Database) -> DocumentIndex | None:
        """Fetch index from cache or load blobs from database (2 reads)."""
        if doc_id in self._cache:
            self._cache.move_to_end(doc_id)
            return self._cache[doc_id]

        chunks = await db.get_chunks_blob(doc_id)
        vectors_data = await db.get_vectors_blob(doc_id)

        if not chunks:
            return None

        if vectors_data:
            vectors_bytes, ids = vectors_data
            doc_meta = await db.get_document(doc_id)
            dim = (doc_meta or {}).get("embedDim", 0)
            vectors_arr = deserialize_vectors(vectors_bytes, len(ids), dim)
        else:
            vectors_arr = np.zeros((0, 0), dtype=np.float16)
            ids = [c["id"] for c in chunks]

        index = DocumentIndex(doc_id, chunks, vectors_arr, ids)

        if len(self._cache) >= self.capacity:
            self._cache.popitem(last=False)
        self._cache[doc_id] = index
        return index

    def invalidate(self, doc_id: str) -> None:
        self._cache.pop(doc_id, None)


retrieval_store = RetrievalStore()
