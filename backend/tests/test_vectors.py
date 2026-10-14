import numpy as np
import pytest

from app.errors import AppError
from app.retrieval.vectors import (
    IndexCache, VectorIndex, decode_vectors, encode_vectors, quote_supported,
)


def test_roundtrip_and_search():
    vecs = [[1, 0, 0], [0, 1, 0], [0.9, 0.1, 0]]
    blob = encode_vectors(vecs)
    assert blob["dim"] == 3 and blob["count"] == 3
    idx = VectorIndex.from_blob(["a", "b", "c"], blob)
    hits = idx.search([1, 0.05, 0], k=2)
    assert [h.chunk_id for h in hits] == ["a", "c"]
    assert hits[0].score > hits[1].score


def test_empty_index_and_zero_query():
    idx = VectorIndex.from_blob([], encode_vectors([]))
    assert idx.search([1, 2, 3]) == []
    idx = VectorIndex.from_blob(["a"], encode_vectors([[1, 0]]))
    assert idx.search([0, 0]) == []


def test_dimension_mismatch_and_corrupt():
    idx = VectorIndex.from_blob(["a"], encode_vectors([[1, 0]]))
    with pytest.raises(ValueError):
        idx.search([1, 0, 0])
    blob = encode_vectors([[1, 0], [0, 1]])
    blob["count"] = 5
    with pytest.raises(AppError):
        decode_vectors(blob)


def test_storage_size_fits_firestore():
    blob = encode_vectors(np.random.rand(150, 768).tolist())
    assert len(blob["data"]) < 400_000  # far below the 1 MiB document limit


def test_lru_evicts_oldest():
    c = IndexCache(capacity=2)
    i = VectorIndex(["a"], np.ones((1, 2), dtype=np.float32))
    c.put("1", i); c.put("2", i); c.get("1"); c.put("3", i)
    assert c.get("2") is None and c.get("1") is i and c.get("3") is i


def test_quote_supported():
    chunk = "A fraction has a numerator\nand a  denominator."
    assert quote_supported("a numerator and a denominator", chunk)
    assert quote_supported("A FRACTION has", chunk)
    assert not quote_supported("fractions are decimals", chunk)
    assert not quote_supported("a", chunk)
