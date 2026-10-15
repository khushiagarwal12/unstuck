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
from .extract import extract_from_pdf, extract_from_text
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

        if file_bytes:
            pages = extract_from_pdf(file_bytes)
        elif pasted_text:
            pages = extract_from_text(doc_title, pasted_text)
        else:
            raise ValueError("Neither file nor text provided")

        page_count = len(pages)
        warnings: list[str] = []

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
            for c in concept_list.concepts:
                await db.save_concept(doc_id, {
                    "id": c.id,
                    "conceptId": c.id,
                    "name": c.name,
                    "description": c.description,
                    "prerequisites": c.prerequisites,
                    "sourceRefs": [r.model_dump() for r in c.source_refs],
                    "catalogStatus": "pending",
                    "misconceptions": [],
                })
        except Exception as exc:
            log.error("Concept extraction failed: %s", exc)
            # Fallback to a single general concept so user is never blocked
            fallback_id = "general-understanding"
            await db.save_concept(doc_id, {
                "id": fallback_id,
                "conceptId": fallback_id,
                "name": doc_title or "Key Concepts",
                "description": "Core concepts and problem solving in this material.",
                "prerequisites": [],
                "sourceRefs": [],
                "catalogStatus": "pending",
                "misconceptions": [],
            })

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
            "status": "error",
            "statusDetail": "Failed to process document.",
            "error": str(exc),
            "updatedAt": _now_iso(),
        })
