"""Best-effort reading of scanned pages and photos with the model's vision (ARCHITECTURE.md 5.1)."""

from __future__ import annotations

import logging

import pymupdf

from ..errors import AppError
from ..llm.client import BaseLLM
from ..llm.prompts import render
from .extract import clean_text

log = logging.getLogger("unstuck.vision")

MAX_VISION_PAGES = 10
NO_TEXT = "NO_TEXT"


def render_pdf_page(data: bytes, index: int, zoom: float = 1.6) -> bytes:
    doc = pymupdf.open(stream=data, filetype="pdf")
    try:
        pix = doc[index].get_pixmap(matrix=pymupdf.Matrix(zoom, zoom), alpha=False)
        return pix.tobytes("png")
    finally:
        doc.close()


async def read_image(llm: BaseLLM, data: bytes, mime: str) -> str:
    """Transcribe one image. Returns '' when nothing readable was found."""
    text = clean_text(await llm.transcribe_image(data, mime, render("transcribe")))
    return "" if text.strip() == NO_TEXT else text


async def read_page_safely(llm: BaseLLM, data: bytes, mime: str) -> str:
    """One bad page must not sink the whole document, but a quota problem must stop everything."""
    try:
        return await read_image(llm, data, mime)
    except AppError as exc:
        if exc.code in {"quota_exceeded", "sample_only", "llm_not_configured"}:
            raise
        log.warning("vision_page_failed code=%s", exc.code)
        return ""
