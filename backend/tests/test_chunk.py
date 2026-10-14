import pytest

from app.errors import AppError
from app.ingestion.chunk import CHUNK_CHARS, MAX_CHUNKS, chunk_pages
from app.ingestion.extract import Page

SENT = "A fraction names equal parts of a whole number. "


def test_short_page_is_one_chunk():
    chunks = chunk_pages([Page(3, SENT * 2)])
    assert len(chunks) == 1 and chunks[0].id == "p3-c0" and chunks[0].page == 3


def test_long_page_splits_within_size_with_unique_ids_and_overlap():
    text = (SENT * 60).strip()
    chunks = chunk_pages([Page(1, text)])
    assert len(chunks) > 1
    assert all(len(c.text) <= CHUNK_CHARS for c in chunks)
    assert len({c.id for c in chunks}) == len(chunks)
    # consecutive chunks share text (overlap)
    assert any(chunks[i + 1].text[:30] in chunks[i].text for i in range(len(chunks) - 1))


def test_no_words_lost():
    words = [f"w{i}" for i in range(1500)]
    chunks = chunk_pages([Page(1, " ".join(words))])
    seen = set()
    for c in chunks:
        seen.update(c.text.split())
    assert seen == set(words)


def test_no_whitespace_text_terminates():
    chunks = chunk_pages([Page(1, "x" * 5000)])
    assert chunks and all(len(c.text) <= CHUNK_CHARS for c in chunks)


def test_scraps_dropped_unless_only_content():
    assert chunk_pages([Page(1, "12")])[0].text == "12"
    assert chunk_pages([Page(1, "")]) == []


def test_too_many_chunks():
    pages = [Page(i + 1, (SENT * 30).strip()) for i in range(MAX_CHUNKS)]
    with pytest.raises(AppError) as e:
        chunk_pages(pages)
    assert e.value.code == "too_much_text"
