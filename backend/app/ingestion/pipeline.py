"""Background document processing (ARCHITECTURE.md sections 5.1 and 5.4).

Stages write their output before the next begins, so a restart resumes at the first missing stage
instead of starting over. Original upload bytes are never stored: the reading stage can only run
while the request that created the job still holds them.
"""

from __future__ import annotations

import logging
import time
from dataclasses import dataclass

from ..config import Settings
from ..errors import AppError
from ..llm.client import BaseLLM
from ..retrieval.vectors import encode_vectors
from ..storage.base import Store
from ..usage import UsageGuard
from .chunk import Chunk, chunk_pages
from .concepts import extract_concepts
from .extract import Extracted, Page
from .vision import MAX_VISION_PAGES, read_page_safely, render_pdf_page

log = logging.getLogger("unstuck.pipeline")

STALE_AFTER_SECONDS = 180
IN_PROGRESS = {"queued", "reading", "indexing", "finding_concepts"}
MIN_READABLE_CHARS = 80
EMBED_BATCH = 100


@dataclass
class Services:
    store: Store
    llm: BaseLLM
    usage: UsageGuard
    settings: Settings


@dataclass
class Job:
    doc_id: str
    uid: str
    judge: bool
    extracted: Extracted | None = None  # None when resuming after a restart
    source: bytes | None = None  # original bytes, only for the reading stage
    is_sample: bool = False


def _doc(doc_id: str) -> str:
    return f"documents/{doc_id}"


async def _status(sv: Services, doc_id: str, status: str, progress: int, detail: str, **extra) -> None:
    await sv.store.merge(
        _doc(doc_id),
        {"status": status, "progress": progress, "statusDetail": detail, "updatedAt": time.time(), **extra},
    )


async def _read_scans(sv: Services, job: Job) -> tuple[list[Page], list[str]]:
    ex = job.extracted
    assert ex is not None
    warnings = list(ex.warnings)
    pages: list[Page] = []
    budget = MAX_VISION_PAGES
    skipped = 0
    for page in ex.pages:
        if not page.needs_vision:
            pages.append(page)
            continue
        if budget == 0 or job.source is None:
            skipped += 1
            pages.append(Page(page.number, page.text))
            continue
        budget -= 1
        await sv.usage.charge(job.uid, "llm_calls", judge=job.judge)
        if ex.kind == "image":
            data, mime = job.source, ex.mime or "image/png"
        else:
            data, mime = render_pdf_page(job.source, page.number - 1), "image/png"
        text = await read_page_safely(sv.llm, data, mime)
        pages.append(Page(page.number, text or page.text))
    if skipped:
        warnings.append(
            f"{skipped} scanned page(s) were not read. Only the first {MAX_VISION_PAGES} scanned pages are read."
        )
    return pages, warnings


async def _stage_chunks(sv: Services, job: Job) -> list[Chunk]:
    path = f"{_doc(job.doc_id)}/blobs/chunks"
    saved = await sv.store.get(path)
    if saved:
        return [Chunk(**c) for c in saved["chunks"]]
    if job.extracted is None:
        raise AppError("restart_needed", "Processing was interrupted. Upload the file again.", status=409)

    needs_reading = any(p.needs_vision for p in job.extracted.pages)
    if needs_reading:
        await _status(sv, job.doc_id, "reading", 15, "Reading scanned pages")
    pages, warnings = await _read_scans(sv, job)

    if sum(len(p.text) for p in pages) < MIN_READABLE_CHARS:
        raise AppError(
            "no_text_found",
            "We couldn't read any text in that file. Try a clearer photo or scan, or paste the text instead.",
            status=422,
        )
    chunks = chunk_pages(pages)
    await sv.store.set(path, {"chunks": [{"id": c.id, "page": c.page, "text": c.text} for c in chunks]})
    await sv.store.merge(_doc(job.doc_id), {"pageCount": len(pages), "warnings": warnings})
    return chunks


async def _stage_vectors(sv: Services, job: Job, chunks: list[Chunk]) -> None:
    path = f"{_doc(job.doc_id)}/blobs/vectors"
    if await sv.store.get(path):
        return
    await _status(sv, job.doc_id, "indexing", 45, "Indexing your material")
    vectors: list[list[float]] = []
    for i in range(0, len(chunks), EMBED_BATCH):
        batch = chunks[i : i + EMBED_BATCH]
        await sv.usage.charge(job.uid, "llm_calls", judge=job.judge)
        vectors.extend(await sv.llm.embed([c.text for c in batch]))
    blob = encode_vectors(vectors)
    await sv.store.set(path, {"ids": [c.id for c in chunks], **blob})
    await sv.store.merge(
        _doc(job.doc_id), {"embedModel": sv.settings.gemini_embed_model, "embedDim": blob["dim"]}
    )


async def _stage_concepts(sv: Services, job: Job, chunks: list[Chunk]) -> None:
    path = f"{_doc(job.doc_id)}/blobs/concepts"
    if await sv.store.get(path):
        return
    await _status(sv, job.doc_id, "finding_concepts", 75, "Finding the key ideas")
    await sv.usage.charge(job.uid, "llm_calls", judge=job.judge)
    concepts = await extract_concepts(sv.llm, chunks)
    await sv.store.set(path, {"concepts": concepts})


async def _cache_sample(sv: Services, doc_id: str, key: str) -> None:
    parts = {}
    for name in ("chunks", "vectors", "concepts"):
        parts[name] = await sv.store.get(f"{_doc(doc_id)}/blobs/{name}")
    await sv.store.set(f"samples/{key}", parts)


async def run(sv: Services, job: Job) -> None:
    """Never raises: failures are recorded on the document so the UI can show them."""
    try:
        chunks = await _stage_chunks(sv, job)
        await _stage_vectors(sv, job, chunks)
        await _stage_concepts(sv, job, chunks)
        await _status(sv, job.doc_id, "concepts_ready", 100, "Ready to study", error=None)
        if job.is_sample:
            doc = await sv.store.get(_doc(job.doc_id)) or {}
            await _cache_sample(sv, job.doc_id, doc.get("contentHash", ""))
    except AppError as exc:
        log.warning("document_failed code=%s", exc.code)
        await _status(sv, job.doc_id, "failed", 0, "Couldn't finish", error={"code": exc.code, "message": exc.message})
    except Exception as exc:  # unexpected: keep details out of logs and responses
        log.error("document_crashed type=%s", type(exc).__name__)
        await _status(
            sv, job.doc_id, "failed", 0, "Couldn't finish",
            error={"code": "processing_failed", "message": "Something went wrong while reading that file. Try again."},
        )


def is_stale(doc: dict, now: float | None = None) -> bool:
    now = time.time() if now is None else now
    return doc.get("status") in IN_PROGRESS and now - float(doc.get("updatedAt", 0)) > STALE_AFTER_SECONDS
