"""Ingestion background pipeline (ARCHITECTURE.md section 5.1).

Executes stages:
queued -> extracting -> vision -> chunking -> embedding -> concepts_ready -> ready
Enables early start at concepts_ready so student starts learning immediately.
"""

from __future__ import annotations

import datetime
import logging
from typing import BinaryIO

from ..config import Settings
from ..llm.client import BaseLLM
from ..llm.schemas import ConceptList
from ..storage.firestore import Database
from .chunk import chunk_pages
from .embed import embed_chunks
from .extract import Page, extract_from_pdf, extract_from_text, extract_upload
from .vision import transcribe_scanned_pages

log = logging.getLogger("unstuck.ingestion.pipeline")


def _now_iso() -> str:
    return datetime.datetime.now(datetime.timezone.utc).isoformat()


async def run_ingestion_pipeline(
    doc_id: str,
    file_bytes: bytes | None,
    pasted_text: str | None,
    doc_title: str,
    db: Database,
    llm: BaseLLM,
    settings: Settings,
) -> None:
    """Run ingestion pipeline in background, updating document status at each stage."""
    try:
        # 1. EXTRACTING
        await db.update_document(doc_id, {
            "status": "extracting",
            "statusDetail": "Extracting text from pages...",
            "progress": 0.15,
            "updatedAt": _now_iso(),
        })

        warnings: list[str] = []
        if file_bytes:
            extracted = extract_upload(file_bytes)
            pages = extracted.pages
            warnings.extend(extracted.warnings)
            if extracted.kind == "image":
                prompt = (
                    "Transcribe all readable study text, equations, and diagrams from this image verbatim. "
                    "Return clean text with mathematical notation formatted neatly. "
                    "Do not add commentary."
                )
                text = await llm.transcribe_image(file_bytes, extracted.mime or "image/png", prompt)
                if not text or text.strip() == "NO_TEXT":
                    await db.update_document(doc_id, {
                        "status": "failed",
                        "statusDetail": "No readable text found. Please paste your notes instead.",
                        "error": {"code": "no_text_found", "message": "No readable text found. Please paste your notes instead."},
                        "updatedAt": _now_iso(),
                    })
                    return
                pages = [Page(1, text.strip())]
        elif pasted_text:
            pages = extract_from_text(doc_title, pasted_text)
        else:
            raise ValueError("Neither file nor text provided")

        page_count = len(pages)

        # 2. VISION (if needed)
        needs_vision_count = sum(1 for p in pages if p.needs_vision)
        if needs_vision_count > 0 and file_bytes:
            await db.update_document(doc_id, {
                "status": "vision",
                "statusDetail": f"Transcribing {needs_vision_count} scanned/handwritten pages...",
                "progress": 0.30,
                "updatedAt": _now_iso(),
            })
            pages, vision_warnings = await transcribe_scanned_pages(pages, file_bytes, settings)
            warnings.extend(vision_warnings)

        # 3. CHUNKING
        await db.update_document(doc_id, {
            "status": "chunking",
            "statusDetail": "Dividing material into searchable sections...",
            "progress": 0.45,
            "updatedAt": _now_iso(),
        })
        chunks = chunk_pages(pages)
        chunks_data = [c.to_dict() for c in chunks]
        await db.save_chunks_blob(doc_id, chunks_data)

        # 4. EMBEDDING
        await db.update_document(doc_id, {
            "status": "embedding",
            "statusDetail": "Embedding sections for citation search...",
            "progress": 0.60,
            "updatedAt": _now_iso(),
        })
        try:
            vectors_bytes, ids, dim = await embed_chunks(chunks, llm)
            await db.save_vectors_blob(doc_id, vectors_bytes, ids)
            embed_dim = dim
        except Exception as exc:
            log.warning("Embedding failed (proceeding without vector search): %s", exc)
            embed_dim = 0
            warnings.append("Vector search disabled for this document due to embedding limit.")

        # 5. CONCEPTS_READY
        await db.update_document(doc_id, {
            "status": "concepts_ready",
            "statusDetail": "Extracting key concepts and study topics...",
            "progress": 0.85,
            "pageCount": page_count,
            "embedDim": embed_dim,
            "warnings": warnings,
            "updatedAt": _now_iso(),
        })

        # Generate concept graph via LLM
        all_text = "\n\n".join(f"[Page {p.page_number}]\n{p.text}" for p in pages)
        # Cap prompt text
        capped_text = all_text[:25_000]

        prompt = (
            f"<STUDY_MATERIAL>\n{capped_text}\n</STUDY_MATERIAL>\n\n"
            f"Extract the 3 to 8 core concepts present in this material, their prerequisites (DAG), "
            f"and include source_refs with exact quotes from the text."
        )

        try:
            concept_list = await llm.generate_structured(
                prompt=prompt,
                schema=ConceptList,
                tier="main",
                system="You are an expert curriculum analyzer. Extract learning concepts with prerequisites and exact quotes into ConceptList JSON.",
            )
            for i, c in enumerate(concept_list.concepts, 1):
                cid = getattr(c, "id", None) or getattr(c, "conceptId", None) or f"c{i}"
                refs = getattr(c, "source_refs", None) or getattr(c, "sources", [])
                await db.save_concept(doc_id, {
                    "id": cid,
                    "conceptId": cid,
                    "name": c.name,
                    "description": c.description,
                    "prerequisites": c.prerequisites,
                    "sourceRefs": [r.model_dump() if hasattr(r, "model_dump") else dict(r) for r in refs],
                    "catalogStatus": "pending",
                    "misconceptions": [],
                })
        except Exception as exc:
            log.error("Concept extraction failed: %s", exc)
            await db.update_document(doc_id, {
                "status": "failed",
                "statusDetail": "AI model failed to extract concepts.",
                "error": {"code": "model_invalid_output", "message": "The AI model output could not be parsed."},
                "updatedAt": _now_iso(),
            })
            return

        # 6. READY
        await db.update_document(doc_id, {
            "status": "ready",
            "statusDetail": "Ready to study!",
            "progress": 1.0,
            "updatedAt": _now_iso(),
        })

    except Exception as exc:
        log.exception("Pipeline failed for doc %s", doc_id)
        await db.update_document(doc_id, {
            "status": "failed",
            "statusDetail": "Failed to process document.",
            "error": {"code": "pipeline_error", "message": str(exc)},
            "updatedAt": _now_iso(),
        })
