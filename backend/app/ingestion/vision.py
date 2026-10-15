"""Vision extraction for scanned PDFs and photos (ARCHITECTURE.md section 5.1).

Best-effort multimodal OCR using Gemini multimodal input.
Capped at 10 pages. Over cap provides a clear partial result warning.
"""

from __future__ import annotations

import logging
from typing import Sequence

from ..config import Settings
from .extract import ExtractedPage

log = logging.getLogger("unstuck.vision")
MAX_VISION_PAGES = 10


async def transcribe_image_page(
    image_bytes: bytes,
    mime_type: str,
    page_number: int,
    settings: Settings,
) -> ExtractedPage:
    """Best-effort transcription of an image using Gemini multimodal."""
    from google import genai
    from google.genai import types

    if not settings.gemini_api_key and settings.llm_backend != "vertex":
        log.warning("Gemini API key not configured for vision transcription")
        return ExtractedPage(page_number=page_number, text="[Scanned image - text extraction unavailable]", needs_vision=False)

    try:
        if settings.llm_backend == "vertex":
            client = genai.Client(
                vertexai=True,
                project=settings.google_cloud_project,
                location=settings.google_cloud_location,
            )
        else:
            client = genai.Client(api_key=settings.gemini_api_key)
        prompt = (
            "Transcribe all readable study text, equations, and diagrams from this image verbatim. "
            "Return clean text with mathematical notation formatted neatly. "
            "Do not add commentary."
        )
        resp = await client.aio.models.generate_content(
            model=settings.gemini_model_main,
            contents=[
                types.Part.from_bytes(data=image_bytes, mime_type=mime_type),
                prompt,
            ],
        )
        text = resp.text or ""
        return ExtractedPage(page_number=page_number, text=text.strip(), needs_vision=False)
    except Exception as exc:
        log.warning("Vision transcription failed for page %d: %s", page_number, exc)
        return ExtractedPage(page_number=page_number, text="[Could not transcribe handwritten or scanned page]", needs_vision=False)


async def transcribe_scanned_pages(
    pages: Sequence[ExtractedPage],
    pdf_bytes: bytes,
    settings: Settings,
) -> tuple[list[ExtractedPage], list[str]]:
    """Transcribe up to 10 flagged pages from a PDF rendering."""
    import fitz  # pymupdf

    warnings: list[str] = []
    flagged_indices = [i for i, p in enumerate(pages) if p.needs_vision]

    if not flagged_indices:
        return list(pages), warnings

    if len(flagged_indices) > MAX_VISION_PAGES:
        warnings.append(
            f"Only the first {MAX_VISION_PAGES} scanned pages were transcribed due to free tier limits."
        )
        to_process = flagged_indices[:MAX_VISION_PAGES]
    else:
        to_process = flagged_indices

    result_pages = list(pages)
    doc = fitz.open(stream=pdf_bytes, filetype="pdf")

    for idx in to_process:
        page = doc[idx]
        # Render page to PNG image pixmap
        pix = page.get_pixmap(dpi=150)
        img_bytes = pix.tobytes("png")
        transcribed = await transcribe_image_page(img_bytes, "image/png", idx + 1, settings)
        result_pages[idx] = transcribed

    return result_pages, warnings
