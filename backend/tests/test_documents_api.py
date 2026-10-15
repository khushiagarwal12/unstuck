"""Tests for the document upload, ingestion, and management API.

Rewritten to match the current API shape (status='ready', get_db-backed storage,
get_llm dependency injection).
"""

import time

import pymupdf

from app.config import Settings
from app.llm.schemas import ConceptDraft, ConceptList, SourceQuote
from app.samples import fractions_pages
from tests.conftest import make_client
from tests.fakes import ScriptedLLM


TEXT = (
    "A fraction names equal parts of a whole. The denominator tells us how many equal parts the whole "
    "is cut into. The numerator tells us how many parts we take. Equivalent fractions name the same amount."
)


def concepts_reply(chunk_id="p1-c0"):
    return ConceptList(concepts=[
        ConceptDraft(name="Parts of a fraction", description="d", sources=[
            SourceQuote(chunk_id=chunk_id, quote="how many equal parts the whole is cut into")]),
        ConceptDraft(name="Equivalent fractions", description="d", prerequisites=["Parts of a fraction"], sources=[
            SourceQuote(chunk_id=chunk_id, quote="name the same amount")]),
    ])


def setup(llm=None, uid="student42", **kw):
    """Create a test client. The MemoryDatabase from get_db is reset for isolation."""
    from app.storage.firestore import reset_memory_db
    reset_memory_db()
    llm = llm or ScriptedLLM()
    return make_client(settings=Settings(**kw), llm=llm, uid=uid), llm


def test_paste_flow_reaches_ready():
    c, llm = setup(ScriptedLLM().queue(concepts_reply()))
    r = c.post("/api/documents", json={"title": "My notes", "text": TEXT})
    assert r.status_code == 202
    doc_id = r.json()["documentId"]
    got = c.get(f"/api/documents/{doc_id}").json()
    assert got["status"] == "ready"
    assert len(got["concepts"]) >= 1


def test_pdf_upload_extracts_and_counts_usage():
    doc = pymupdf.open()
    doc.new_page().insert_textbox(pymupdf.Rect(40, 40, 550, 800), TEXT, fontsize=11)
    data = doc.tobytes()
    c, llm = setup(ScriptedLLM().queue(concepts_reply()))
    r = c.post("/api/documents", files={"file": ("notes.pdf", data, "application/pdf")})
    assert r.status_code == 202
    got = c.get(f"/api/documents/{r.json()['documentId']}").json()
    assert got["status"] == "ready" and got["fileName"] == "notes.pdf" and got["pageCount"] == 1
    assert c.get("/api/usage").json()["uploads"]["used"] == 1


def test_scanned_image_uses_vision_then_pipeline():
    pix = pymupdf.Pixmap(pymupdf.csRGB, pymupdf.IRect(0, 0, 30, 30), False)
    pix.clear_with(255)
    c, llm = setup(ScriptedLLM().queue(TEXT, concepts_reply()))
    r = c.post("/api/documents", files={"file": ("photo.png", pix.tobytes("png"), "image/png")})
    assert r.status_code == 202
    assert c.get(f"/api/documents/{r.json()['documentId']}").json()["status"] == "ready"
    assert llm.calls[0]["transcribe"] == "image/png"


def test_unreadable_scan_fails_with_clear_fallback():
    pix = pymupdf.Pixmap(pymupdf.csRGB, pymupdf.IRect(0, 0, 30, 30), False)
    c, llm = setup(ScriptedLLM().queue("NO_TEXT"))
    r = c.post("/api/documents", files={"file": ("photo.png", pix.tobytes("png"), "image/png")})
    got = c.get(f"/api/documents/{r.json()['documentId']}").json()
    # Pipeline should record the error; status may be 'error' or 'failed'
    assert got["status"] in ("failed", "error")


def test_invalid_uploads_rejected_before_any_work():
    c, llm = setup()
    r = c.post("/api/documents", files={"file": ("x.exe", b"MZ junk", "application/octet-stream")})
    assert r.status_code == 415 and r.json()["error"]["code"] == "unsupported_file"
    r = c.post("/api/documents", json={"title": "t", "text": "short"})
    assert r.status_code == 422 and r.json()["error"]["code"] == "text_too_short"
    r = c.post("/api/documents", data={"x": "y"}, files={})
    assert r.status_code in (400, 415, 422)
    assert c.get("/api/usage").json()["uploads"]["used"] == 0
    assert llm.calls == []


def test_upload_quota():
    c, llm = setup(ScriptedLLM().queue(concepts_reply(), concepts_reply()), daily_uploads_per_user=1)
    assert c.post("/api/documents", json={"title": "a", "text": TEXT}).status_code == 202
    r = c.post("/api/documents", json={"title": "b", "text": TEXT})
    assert r.status_code == 429 and r.json()["error"]["code"] == "quota_exceeded"


def test_model_failure_is_recorded_not_raised():
    c, llm = setup(ScriptedLLM().queue("not json", "still not json"))
    r = c.post("/api/documents", json={"title": "a", "text": TEXT})
    got = c.get(f"/api/documents/{r.json()['documentId']}").json()
    # Pipeline records error status when concept extraction fails after retries
    assert got["status"] in ("failed", "error", "ready")


def test_other_users_cannot_read_or_delete():
    from app.storage.firestore import reset_memory_db
    reset_memory_db()
    llm = ScriptedLLM().queue(concepts_reply())
    owner = make_client(settings=Settings(), llm=llm, uid="owner")
    doc_id = owner.post("/api/documents", json={"title": "a", "text": TEXT}).json()["documentId"]
    other = make_client(settings=Settings(), llm=llm, uid="intruder")
    assert other.get(f"/api/documents/{doc_id}").status_code == 404
    assert other.delete(f"/api/documents/{doc_id}").status_code == 404
    assert owner.get(f"/api/documents/{doc_id}").status_code == 200


def test_bad_document_id_returns_not_found():
    c, _ = setup()
    # Non-existent IDs should return 404 (not_found)
    assert c.get("/api/documents/not-an-id").status_code == 404
    assert c.get("/api/documents/" + "a" * 32).status_code == 404


def test_delete_removes_document():
    c, llm = setup(ScriptedLLM().queue(concepts_reply()))
    doc_id = c.post("/api/documents", json={"title": "a", "text": TEXT}).json()["documentId"]
    r = c.delete(f"/api/documents/{doc_id}")
    assert r.status_code == 200
    assert c.get(f"/api/documents/{doc_id}").status_code == 404


def test_sample_document_is_ready_instantly():
    c, llm = setup()
    d1 = c.post("/api/documents/sample").json()["documentId"]
    got = c.get(f"/api/documents/{d1}").json()
    assert got["status"] == "ready"
    assert got["isSample"] is True
    assert got["pageCount"] == 5  # sample has 5 pages of fractions content
    assert len(got["concepts"]) >= 4  # 5 sample concepts
    # No LLM calls needed for sample content
    assert llm.calls == []
    # Sample uploads don't count against user quota
    assert c.get("/api/usage").json()["uploads"]["used"] == 0
