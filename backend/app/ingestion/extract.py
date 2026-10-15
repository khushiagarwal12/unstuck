"""Validate an upload and pull text out of it, keeping page numbers (ARCHITECTURE.md section 5.1).

Nothing here is persisted: the original bytes live only for the length of the request.
"""

from __future__ import annotations

import re
import unicodedata
from dataclasses import dataclass, field
from typing import BinaryIO, Literal

import pymupdf

from ..errors import AppError

MAX_BYTES = 15 * 1024 * 1024
MAX_PAGES = 40
MIN_PAGE_CHARS = 50  # fewer than this on a PDF page means it is probably a scan
MIN_PASTE_CHARS = 80
MAX_PASTE_CHARS = 60_000

Kind = Literal["pdf", "image", "text"]

_CONTROL = re.compile(r"[\x00-\x08\x0b\x0c\x0e-\x1f\x7f]")
_SPACES = re.compile(r"[ \t ]+")
_BLANK_LINES = re.compile(r"\n{3,}")


@dataclass
class Page:
    number: int = 1
    text: str = ""
    needs_vision: bool = False
    page_number: int | None = None

    def __post_init__(self):
        if self.page_number is not None:
            self.number = self.page_number
        else:
            self.page_number = self.number


ExtractedPage = Page


@dataclass
class Extracted:
    kind: Kind
    pages: list[Page]
    mime: str | None = None
    warnings: list[str] = field(default_factory=list)


def clean_text(raw: str) -> str:
    """Strip control characters and tidy whitespace without changing the words."""
    text = unicodedata.normalize("NFC", raw).replace("\r\n", "\n").replace("\r", "\n")
    text = _CONTROL.sub("", text)
    text = "\n".join(_SPACES.sub(" ", line).strip() for line in text.split("\n"))
    return _BLANK_LINES.sub("\n\n", text).strip()


def sniff(data: bytes) -> Literal["pdf", "png", "jpeg"] | None:
    """Decide the type from the bytes themselves, never from the filename or declared type."""
    if data.startswith(b"%PDF-"):
        return "pdf"
    if data.startswith(b"\x89PNG\r\n\x1a\n"):
        return "png"
    if data.startswith(b"\xff\xd8\xff"):
        return "jpeg"
    return None


def extract_upload(data: bytes) -> Extracted:
    if len(data) > MAX_BYTES:
        raise AppError("file_too_large", "That file is over 15 MB. Choose a smaller one.", status=413)
    if not data:
        raise AppError("unreadable_file", "That file is empty.", status=422)

    kind = sniff(data)
    if kind is None:
        raise AppError("unsupported_file", "Choose a PDF, PNG or JPG file.", status=415)
    if kind in ("png", "jpeg"):
        mime = "image/png" if kind == "png" else "image/jpeg"
        return Extracted("image", [Page(1, "", needs_vision=True)], mime=mime)
    return _extract_pdf(data)


def _extract_pdf(data: bytes) -> Extracted:
    try:
        doc = pymupdf.open(stream=data, filetype="pdf")
    except Exception:
        raise AppError("unreadable_file", "We couldn't open that PDF. It may be damaged.", status=422)
    try:
        if doc.needs_pass:
            raise AppError("pdf_encrypted", "That PDF is password protected. Remove the password and try again.", status=422)
        if doc.page_count == 0:
            raise AppError("unreadable_file", "That PDF has no pages.", status=422)
        if doc.page_count > MAX_PAGES:
            raise AppError(
                "too_many_pages",
                f"That PDF has {doc.page_count} pages. The limit is {MAX_PAGES}. Upload the chapter you want to study.",
                status=413,
            )
        pages: list[Page] = []
        for i in range(doc.page_count):
            try:
                text = clean_text(doc[i].get_text("text"))
            except Exception:
                text = ""
            pages.append(Page(i + 1, text, needs_vision=len(text) < MIN_PAGE_CHARS))
        return Extracted("pdf", pages, mime="application/pdf")
    finally:
        doc.close()


def extract_pasted(raw: str) -> Extracted:
    text = clean_text(raw)
    if len(text) < MIN_PASTE_CHARS:
        raise AppError("text_too_short", "Paste a few more sentences so there's enough to learn from.", status=422)
    if len(text) > MAX_PASTE_CHARS:
        raise AppError("text_too_long", "That's too much text at once. Paste one section at a time.", status=413)
    return Extracted("text", [Page(1, text)])


def extract_from_pdf(stream_or_bytes: bytes | BinaryIO) -> list[Page]:
    data = stream_or_bytes if isinstance(stream_or_bytes, bytes) else stream_or_bytes.read()
    res = _extract_pdf(data)
    return res.pages


def extract_from_text(title: str, text: str) -> list[Page]:
    res = extract_pasted(text)
    return res.pages
