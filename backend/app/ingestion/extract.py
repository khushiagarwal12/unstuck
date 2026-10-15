"""Document extraction (ARCHITECTURE.md section 5.1).

Uses PyMuPDF (fitz) for fast native extraction.
Caps: 15 MB, 40 pages. Pages with < 50 chars flagged needs_vision.
"""

from __future__ import annotations

import re
from dataclasses import dataclass
from typing import BinaryIO

from ..errors import AppError

MAX_BYTES = 15 * 1024 * 1024
MAX_PAGES = 40
MIN_CHARS_FOR_TEXT = 50


@dataclass
class ExtractedPage:
    page_number: int  # 1-indexed
    text: str
    needs_vision: bool = False


def clean_text(text: str) -> str:
    """Strip control characters, normalize line breaks and spaces."""
    # Remove control characters except standard whitespace
    cleaned = re.sub(r"[\x00-\x08\x0b\x0c\x0e-\x1f\x7f]", "", text)
    # Normalize multiple newlines/spaces
    cleaned = re.sub(r"\r\n|\r", "\n", cleaned)
    cleaned = re.sub(r"[ \t]+", " ", cleaned)
    cleaned = re.sub(r"\n{3,}", "\n\n", cleaned)
    return cleaned.strip()


def extract_from_pdf(stream_or_bytes: bytes | BinaryIO) -> list[ExtractedPage]:
    """Extract text page by page from PDF using PyMuPDF."""
    import fitz  # pymupdf

    data = stream_or_bytes if isinstance(stream_or_bytes, bytes) else stream_or_bytes.read()
    if len(data) > MAX_BYTES:
        raise AppError("file_too_large", "The file exceeds the 15 MB limit.", status=400)

    try:
        doc = fitz.open(stream=data, filetype="pdf")
    except Exception as exc:
        raise AppError("invalid_file", "Could not parse the PDF file.", status=400) from exc

    page_count = len(doc)
    if page_count > MAX_PAGES:
        raise AppError("too_many_pages", f"Documents are limited to {MAX_PAGES} pages (found {page_count}).", status=400)

    pages: list[ExtractedPage] = []
    for idx in range(page_count):
        page = doc[idx]
        raw_text = clean_text(page.get_text())
        needs_vision = len(raw_text) < MIN_CHARS_FOR_TEXT
        pages.append(ExtractedPage(page_number=idx + 1, text=raw_text, needs_vision=needs_vision))

    return pages


def extract_from_text(title: str, text: str) -> list[ExtractedPage]:
    """Convert pasted text into a single pseudo-page."""
    cleaned = clean_text(text)
    if len(cleaned) < MIN_CHARS_FOR_TEXT:
        raise AppError("too_short", f"Pasted text is too short (minimum {MIN_CHARS_FOR_TEXT} characters).", status=400)
    return [ExtractedPage(page_number=1, text=cleaned, needs_vision=False)]
