import time

import pymupdf

from app.config import Settings
from app.llm.schemas import ConceptDraft, ConceptList, SourceQuote
from app.samples import fractions_pages
from tests.conftest import make_client
from tests.fakes import MemoryStore, ScriptedLLM

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


def setup(llm=None, store=None, **kw):
    llm = llm or ScriptedLLM()
    store = store or MemoryStore()
    return make_client(settings=Settings(**kw), llm=llm, store=store), llm, store


def test_paste_flow_reaches_concepts_ready():
    c, llm, store = setup(ScriptedLLM().queue(concepts_reply()))
    r = c.post("/api/documents", json={"title": "My notes", "text": TEXT})
    assert r.status_code == 202
    doc_id = r.json()["documentId"]
    got = c.get(f"/api/documents/{doc_id}").json()
    assert got["status"] == "concepts_ready" and got["progress"] == 100
    assert [x["name"] for x in got["concepts"]] == ["Parts of a fraction", "Equivalent fractions"]
    assert got["concepts"][1]["prerequisites"] == ["c1"] and got["concepts"][0]["pages"] == [1]
    assert "sourceRefs" not in got["concepts"][0]
    assert store.paths(f"documents/{doc_id}/blobs") == [f"documents/{doc_id}/blobs/{n}" for n in ("chunks", "concepts", "vectors")]


def test_pdf_upload_extracts_and_counts_usage():
    doc = pymupdf.open()
    doc.new_page().insert_textbox(pymupdf.Rect(40, 40, 550, 800), TEXT, fontsize=11)
    data = doc.tobytes()
    c, llm, store = setup(ScriptedLLM().queue(concepts_reply()))
    r = c.post("/api/documents", files={"file": ("notes.pdf", data, "application/pdf")})
    assert r.status_code == 202
    got = c.get(f"/api/documents/{r.json()['documentId']}").json()
    assert got["status"] == "concepts_ready" and got["title"] == "notes.pdf" and got["pageCount"] == 1
    assert c.get("/api/usage").json()["uploads"]["used"] == 1


def test_scanned_image_uses_vision_then_pipeline():
    pix = pymupdf.Pixmap(pymupdf.csRGB, pymupdf.IRect(0, 0, 30, 30), False)
    pix.clear_with(255)
    c, llm, store = setup(ScriptedLLM().queue(TEXT, concepts_reply()))
    r = c.post("/api/documents", files={"file": ("photo.png", pix.tobytes("png"), "image/png")})
    assert r.status_code == 202
    assert c.get(f"/api/documents/{r.json()['documentId']}").json()["status"] == "concepts_ready"
    assert llm.calls[0]["transcribe"] == "image/png"


def test_unreadable_scan_fails_with_clear_fallback():
    pix = pymupdf.Pixmap(pymupdf.csRGB, pymupdf.IRect(0, 0, 30, 30), False)
    c, llm, store = setup(ScriptedLLM().queue("NO_TEXT"))
    r = c.post("/api/documents", files={"file": ("photo.png", pix.tobytes("png"), "image/png")})
    got = c.get(f"/api/documents/{r.json()['documentId']}").json()
    assert got["status"] == "failed" and got["error"]["code"] == "no_text_found"
    assert "paste" in got["error"]["message"].lower()


def test_invalid_uploads_rejected_before_any_work():
    c, llm, store = setup()
    r = c.post("/api/documents", files={"file": ("x.exe", b"MZ junk", "application/octet-stream")})
    assert r.status_code == 415 and r.json()["error"]["code"] == "unsupported_file"
    r = c.post("/api/documents", json={"title": "t", "text": "short"})
    assert r.status_code == 422 and r.json()["error"]["code"] == "text_too_short"
    r = c.post("/api/documents", data={"x": "y"}, files={})
    assert r.status_code in (415, 422)
    assert c.get("/api/usage").json()["uploads"]["used"] == 0
    assert llm.calls == []


def test_upload_quota():
    c, llm, store = setup(daily_uploads_per_user=1)
    llm.queue(concepts_reply(), concepts_reply())
    assert c.post("/api/documents", json={"title": "a", "text": TEXT}).status_code == 202
    r = c.post("/api/documents", json={"title": "b", "text": TEXT})
    assert r.status_code == 429 and r.json()["error"]["code"] == "quota_exceeded"


def test_model_failure_is_recorded_not_raised():
    c, llm, store = setup(ScriptedLLM().queue("not json", "still not json"))
    r = c.post("/api/documents", json={"title": "a", "text": TEXT})
    got = c.get(f"/api/documents/{r.json()['documentId']}").json()
    assert got["status"] == "failed" and got["error"]["code"] == "model_invalid_output"


def test_other_users_cannot_read_or_delete():
    store, llm = MemoryStore(), ScriptedLLM().queue(concepts_reply())
    owner = make_client(settings=Settings(), llm=llm, store=store, uid="owner")
    doc_id = owner.post("/api/documents", json={"title": "a", "text": TEXT}).json()["documentId"]
    other = make_client(settings=Settings(), llm=llm, store=store, uid="intruder")
    assert other.get(f"/api/documents/{doc_id}").status_code == 404
    assert other.delete(f"/api/documents/{doc_id}").status_code == 404
    assert owner.get(f"/api/documents/{doc_id}").status_code == 200


def test_bad_document_id_is_rejected():
    c, _, _ = setup()
    assert c.get("/api/documents/not-an-id").status_code == 422
    assert c.get("/api/documents/" + "a" * 32).status_code == 404


def test_delete_removes_everything():
    c, llm, store = setup(ScriptedLLM().queue(concepts_reply()))
    doc_id = c.post("/api/documents", json={"title": "a", "text": TEXT}).json()["documentId"]
    assert c.delete(f"/api/documents/{doc_id}").json() == {"deleted": True}
    assert store.paths(f"documents/{doc_id}") == []
    assert c.get(f"/api/documents/{doc_id}").status_code == 404


def test_stale_job_resumes_from_saved_stage():
    c, llm, store = setup(ScriptedLLM().queue(concepts_reply()))
    doc_id = c.post("/api/documents", json={"title": "a", "text": TEXT}).json()["documentId"]
    import asyncio
    asyncio.run(store.delete(f"documents/{doc_id}/blobs/concepts"))
    asyncio.run(store.merge(f"documents/{doc_id}", {"status": "finding_concepts", "updatedAt": time.time() - 600}))
    llm.queue(concepts_reply())
    got = c.get(f"/api/documents/{doc_id}").json()
    assert got["status"] in ("finding_concepts", "concepts_ready")
    again = c.get(f"/api/documents/{doc_id}").json()
    assert again["status"] == "concepts_ready" and len(again["concepts"]) == 2


def test_sample_is_processed_once_then_copied_without_model_calls():
    chunks_ids = ["p1-c0"]
    reply = ConceptList(concepts=[
        ConceptDraft(name="What a fraction is", description="d", sources=[SourceQuote(
            chunk_id="p1-c0", quote="how many equal parts the whole is cut into")]),
        ConceptDraft(name="Equivalent fractions", description="d", sources=[SourceQuote(
            chunk_id="p2-c0", quote="name the same amount using different numbers")]),
    ])
    store, llm = MemoryStore(), ScriptedLLM().queue(reply)
    first = make_client(settings=Settings(), llm=llm, store=store, uid="a")
    d1 = first.post("/api/documents/sample").json()["documentId"]
    assert first.get(f"/api/documents/{d1}").json()["status"] == "concepts_ready"
    calls = len(llm.calls)

    second = make_client(settings=Settings(), llm=llm, store=store, uid="b")
    r = second.post("/api/documents/sample").json()
    assert r["status"] == "concepts_ready" and len(llm.calls) == calls
    got = second.get(f"/api/documents/{r['documentId']}").json()
    assert got["isSample"] and got["pageCount"] == len(fractions_pages()) and len(got["concepts"]) == 2
    assert second.get("/api/usage").json()["uploads"]["used"] == 0
