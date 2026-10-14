"""Documents API (ARCHITECTURE.md section 7). Every route checks that the caller owns the document."""

from __future__ import annotations

import hashlib
import time
import uuid

from fastapi import APIRouter, BackgroundTasks, Depends, Path, Request
from pydantic import BaseModel, Field, ValidationError

from ..auth import User, current_user
from ..config import Settings, get_settings
from ..deps import get_llm, get_store, get_usage, judge_flag
from ..errors import AppError
from ..ingestion import pipeline
from ..ingestion.extract import MAX_BYTES, Extracted, extract_pasted, extract_upload
from ..llm.client import BaseLLM
from ..samples import FRACTIONS_TITLE, fractions_pages
from ..storage.base import Store
from ..usage import UsageGuard

router = APIRouter(prefix="/api/documents", tags=["documents"])

DocId = Path(pattern=r"^[0-9a-f]{32}$")
BLOBS = ("chunks", "vectors", "concepts")
MULTIPART_OVERHEAD = 1024 * 1024


class PasteBody(BaseModel):
    title: str = Field(default="Pasted notes", max_length=120)
    text: str


def get_services(
    store: Store = Depends(get_store),
    llm: BaseLLM = Depends(get_llm),
    usage: UsageGuard = Depends(get_usage),
    settings: Settings = Depends(get_settings),
) -> pipeline.Services:
    return pipeline.Services(store=store, llm=llm, usage=usage, settings=settings)


def _new_id() -> str:
    return uuid.uuid4().hex


def _title(name: str | None, fallback: str) -> str:
    cleaned = " ".join((name or "").split())[:120]
    return cleaned or fallback


async def _create_record(sv: pipeline.Services, *, doc_id: str, uid: str, title: str, content_hash: str, kind: str, is_sample: bool) -> None:
    now = time.time()
    await sv.store.set(
        f"documents/{doc_id}",
        {
            "userId": uid, "fileName": title, "contentHash": content_hash, "kind": kind,
            "status": "queued", "statusDetail": "Waiting to start", "progress": 5, "pageCount": 0,
            "isSample": is_sample, "warnings": [], "error": None, "createdAt": now, "updatedAt": now,
        },
    )


async def _read_request(request: Request) -> tuple[str, str, bytes | None, object]:
    """Return (title, content_hash, source_bytes, extracted) for a multipart upload or pasted JSON."""
    ctype = request.headers.get("content-type", "")
    if ctype.startswith("multipart/form-data"):
        length = request.headers.get("content-length")
        if length and length.isdigit() and int(length) > MAX_BYTES + MULTIPART_OVERHEAD:
            raise AppError("file_too_large", "That file is over 15 MB. Choose a smaller one.", status=413)
        form = await request.form()
        upload = form.get("file")
        if upload is None or not hasattr(upload, "read"):
            raise AppError("missing_file", "Choose a file to upload.", status=422)
        data = await upload.read(MAX_BYTES + 1)
        extracted = extract_upload(data)
        return _title(getattr(upload, "filename", None), "Uploaded file"), hashlib.sha256(data).hexdigest(), data, extracted
    try:
        body = PasteBody.model_validate(await request.json())
    except (ValidationError, ValueError):
        raise AppError("invalid_request", "Send a file, or a title and some text.", status=422)
    extracted = extract_pasted(body.text)
    digest = hashlib.sha256(extracted.pages[0].text.encode()).hexdigest()
    return _title(body.title, "Pasted notes"), digest, None, extracted


@router.post("", status_code=202)
async def create_document(
    request: Request,
    background: BackgroundTasks,
    user: User = Depends(current_user),
    sv: pipeline.Services = Depends(get_services),
    judge: bool = Depends(judge_flag),
) -> dict:
    title, digest, source, extracted = await _read_request(request)
    await sv.usage.charge(user.uid, "uploads", judge=judge)
    doc_id = _new_id()
    await _create_record(sv, doc_id=doc_id, uid=user.uid, title=title, content_hash=digest, kind=extracted.kind, is_sample=False)
    job = pipeline.Job(doc_id=doc_id, uid=user.uid, judge=judge, extracted=extracted, source=source)
    background.add_task(pipeline.run, sv, job)
    return {"documentId": doc_id, "status": "queued"}


@router.post("/sample", status_code=202)
async def create_sample(
    background: BackgroundTasks,
    user: User = Depends(current_user),
    sv: pipeline.Services = Depends(get_services),
    judge: bool = Depends(judge_flag),
) -> dict:
    """The committed sample notes. Processed with the model once, then copied for everyone."""
    pages = fractions_pages()
    digest = hashlib.sha256("\n".join(p.text for p in pages).encode()).hexdigest()
    doc_id = _new_id()
    await _create_record(sv, doc_id=doc_id, uid=user.uid, title=FRACTIONS_TITLE, content_hash=digest, kind="text", is_sample=True)

    cached = await sv.store.get(f"samples/{digest}")
    if cached and all(cached.get(n) for n in BLOBS):
        for name in BLOBS:
            await sv.store.set(f"documents/{doc_id}/blobs/{name}", cached[name])
        await sv.store.merge(
            f"documents/{doc_id}",
            {"status": "concepts_ready", "progress": 100, "statusDetail": "Ready to study",
             "pageCount": len(pages), "updatedAt": time.time()},
        )
        return {"documentId": doc_id, "status": "concepts_ready"}

    job = pipeline.Job(
        doc_id=doc_id, uid=user.uid, judge=judge, is_sample=True,
        extracted=Extracted("text", pages, warnings=[]),
    )
    background.add_task(pipeline.run, sv, job)
    return {"documentId": doc_id, "status": "queued"}


async def _owned(store: Store, doc_id: str, uid: str) -> dict:
    doc = await store.get(f"documents/{doc_id}")
    if not doc or doc.get("userId") != uid:
        raise AppError("not_found", "We couldn't find that document.", status=404)
    return doc


def _public_concepts(raw: list[dict]) -> list[dict]:
    return [
        {
            "id": c["id"], "name": c["name"], "description": c["description"],
            "prerequisites": c["prerequisites"],
            "pages": sorted({r["page"] for r in c["sourceRefs"]}),
        }
        for c in raw
    ]


@router.get("/{doc_id}")
async def get_document(
    background: BackgroundTasks,
    doc_id: str = DocId,
    user: User = Depends(current_user),
    sv: pipeline.Services = Depends(get_services),
    judge: bool = Depends(judge_flag),
) -> dict:
    doc = await _owned(sv.store, doc_id, user.uid)
    if pipeline.is_stale(doc):
        # The job died (instance restarted). Touch the record so only one poll restarts it.
        await sv.store.merge(f"documents/{doc_id}", {"updatedAt": time.time()})
        background.add_task(pipeline.run, sv, pipeline.Job(doc_id=doc_id, uid=user.uid, judge=judge))
    out = {
        "id": doc_id, "title": doc.get("fileName", ""), "status": doc["status"],
        "progress": doc.get("progress", 0), "statusDetail": doc.get("statusDetail", ""),
        "pageCount": doc.get("pageCount", 0), "warnings": doc.get("warnings", []),
        "error": doc.get("error"), "isSample": bool(doc.get("isSample")),
    }
    if doc["status"] == "concepts_ready":
        blob = await sv.store.get(f"documents/{doc_id}/blobs/concepts")
        out["concepts"] = _public_concepts((blob or {}).get("concepts", []))
    return out


@router.delete("/{doc_id}")
async def delete_document(
    doc_id: str = DocId,
    user: User = Depends(current_user),
    store: Store = Depends(get_store),
) -> dict:
    await _owned(store, doc_id, user.uid)
    for name in BLOBS:
        await store.delete(f"documents/{doc_id}/blobs/{name}")
    await store.delete(f"documents/{doc_id}")
    return {"deleted": True}
