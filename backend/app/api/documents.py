"""Document endpoints (ARCHITECTURE.md section 7).

Upload/paste notes, monitor ingestion progress, clone the verified sample notes.
"""

from __future__ import annotations

import datetime
import hashlib
import json
import uuid
from typing import Optional

from fastapi import APIRouter, BackgroundTasks, Depends, File, Form, Request, UploadFile

from ..auth import User, current_user
from ..config import Settings, get_settings
from ..errors import AppError
from ..ingestion.chunk import TextChunk
from ..ingestion.pipeline import run_ingestion_pipeline
from ..deps import get_llm
from ..llm.client import BaseLLM
from ..sample.fractions_data import (
    SAMPLE_CONCEPTS,
    SAMPLE_DOC_TITLE,
    SAMPLE_QUESTIONS,
    SAMPLE_TEXT,
)
from ..storage.firestore import Database, get_db

router = APIRouter(prefix="/api/documents", tags=["documents"])


def _today_str() -> str:
    return datetime.datetime.now(datetime.timezone.utc).strftime("%Y-%m-%d")


def _now_iso() -> str:
    return datetime.datetime.now(datetime.timezone.utc).isoformat()


from ..ingestion.extract import extract_pasted, extract_upload

@router.post("", status_code=202)
async def create_document(
    request: Request,
    background_tasks: BackgroundTasks,
    file: Optional[UploadFile] = File(default=None),
    user: User = Depends(current_user),
    db: Database = Depends(get_db),
    settings: Settings = Depends(get_settings),
    llm: BaseLLM = Depends(get_llm),
):
    """Upload a PDF/PNG/JPG file or provide JSON {title, text}."""
    file_bytes: bytes | None = None
    pasted_text: str | None = None
    doc_title: str = "Notes"

    # 1. Validate payload before consuming user quota
    content_type = request.headers.get("content-type", "")
    if "application/json" in content_type:
        try:
            body = await request.json()
        except Exception:
            raise AppError("invalid_request", "Invalid JSON payload.", status=400)
        pasted_text = body.get("text", "")
        doc_title = body.get("title", "Pasted notes")
        extract_pasted(pasted_text)
        content_hash = hashlib.sha256(pasted_text.encode("utf-8")).hexdigest()[:16]
    elif file is not None and getattr(file, "filename", None):
        file_bytes = await file.read()
        doc_title = file.filename or "Uploaded document"
        extract_upload(file_bytes)
        content_hash = hashlib.sha256(file_bytes).hexdigest()[:16]
    else:
        raise AppError("unsupported_file", "Provide either a supported file or pasted text.", status=415)

    # 2. Check and increment usage quota
    today = _today_str()
    allowed = await db.check_and_increment_usage(user.uid, "uploads", settings.daily_uploads_per_user, today)
    if not allowed:
        raise AppError("quota_exceeded", "Daily upload limit reached. Try the sample notes or check back tomorrow.", status=429)

    doc_id = f"doc_{uuid.uuid4().hex[:12]}"
    doc_record = {
        "id": doc_id,
        "userId": user.uid,
        "fileName": doc_title,
        "contentHash": content_hash,
        "status": "queued",
        "statusDetail": "Queued for processing...",
        "progress": 0.05,
        "pageCount": 0,
        "isSample": False,
        "visionPagesUsed": 0,
        "embedModel": settings.gemini_embed_model,
        "embedDim": 0,
        "warnings": [],
        "createdAt": _now_iso(),
        "updatedAt": _now_iso(),
    }
    await db.save_document(doc_id, doc_record)

    background_tasks.add_task(
        run_ingestion_pipeline,
        doc_id=doc_id,
        file_bytes=file_bytes,
        pasted_text=pasted_text,
        doc_title=doc_title,
        db=db,
        llm=llm,
        settings=settings,
    )

    return {"documentId": doc_id, "status": "queued"}


@router.post("/sample")
async def create_sample_document(
    user: User = Depends(current_user),
    db: Database = Depends(get_db),
    settings: Settings = Depends(get_settings),
):
    """Instantly clone the hand-verified fractions sample notes for this user."""
    doc_id = f"doc_sample_{uuid.uuid4().hex[:8]}"

    # Save document record (already ready!)
    await db.save_document(doc_id, {
        "id": doc_id,
        "userId": user.uid,
        "fileName": SAMPLE_DOC_TITLE,
        "contentHash": "sample_fractions_v1",
        "status": "ready",
        "statusDetail": "Pre-processed sample notes ready to study.",
        "progress": 1.0,
        "pageCount": 5,
        "isSample": True,
        "visionPagesUsed": 0,
        "embedModel": "curated",
        "embedDim": 3,
        "warnings": [],
        "createdAt": _now_iso(),
        "updatedAt": _now_iso(),
    })

    # Save sample chunks
    chunks_data = [
        {"id": "c0", "page": 1, "text": "Equal parts of a whole. Denominator tells how many equal parts the whole is divided into. Numerator tells how many parts we consider."},
        {"id": "c1", "page": 2, "text": "Unit fractions: as denominator increases, size of each piece decreases! 1/8 is smaller than 1/4."},
        {"id": "c2", "page": 3, "text": "Comparing fractions: 2/3 is greater than 3/8. In 3/8, the 8 means very small pieces, so 3/8 is less than half, while 2/3 is more than half."},
        {"id": "c3", "page": 4, "text": "Equivalent fractions represent the same amount: 1/2 = 2/4 = 3/6 = 4/8. Multiply or divide numerator and denominator by common factors."},
        {"id": "c4", "page": 5, "text": "Adding fractions: never add the denominators! 1/5 + 2/5 = 3/5."},
    ]
    await db.save_chunks_blob(doc_id, chunks_data)

    # Save sample concepts
    for concept in SAMPLE_CONCEPTS:
        await db.save_concept(doc_id, concept)

    # Save sample questions
    for q in SAMPLE_QUESTIONS:
        await db.save_question(doc_id, q)

    return {"documentId": doc_id}


@router.get("/{doc_id}")
async def get_document(
    doc_id: str,
    user: User = Depends(current_user),
    db: Database = Depends(get_db),
):
    """Poll document status and list extracted concepts."""
    doc = await db.get_document(doc_id)
    if not doc or doc.get("userId") != user.uid:
        raise AppError("not_found", "Document not found.", status=404)

    concepts = await db.get_concepts(doc_id)
    res = {
        "id": doc_id,
        "status": doc.get("status"),
        "progress": doc.get("progress", 0.0),
        "statusDetail": doc.get("statusDetail", ""),
        "pageCount": doc.get("pageCount", 0),
        "fileName": doc.get("fileName", ""),
        "isSample": doc.get("isSample", False),
        "warnings": doc.get("warnings", []),
        "concepts": concepts,
    }
    if "error" in doc:
        res["error"] = doc["error"]
    return res


@router.delete("/{doc_id}")
async def delete_document(
    doc_id: str,
    user: User = Depends(current_user),
    db: Database = Depends(get_db),
):
    """Delete document and derived data."""
    doc = await db.get_document(doc_id)
    if not doc or doc.get("userId") != user.uid:
        raise AppError("not_found", "Document not found.", status=404)

    await db.delete_document(doc_id)
    return {"deleted": True, "ok": True}
