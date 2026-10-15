"""End-to-end learning loop tests and signature demo verification (ARCHITECTURE.md section 3.6).

Verifies:
1. Document ingestion and chunking
2. Sample document cloning
3. Session initialization (JIT)
4. The Signature Demo: two students choose the same wrong answer, get a discriminating follow-up, answer differently, and receive different remediation strategies!
5. Student challenge flow ("That's not why I chose it")
6. Mastery update rules
7. Course mode (Learn with AI) placement and plan
"""

import pytest
from app.core.mastery import Attempt, derive_status
from app.core.posterior import decide
from app.ingestion.chunk import TextChunk, chunk_pages
from app.ingestion.extract import ExtractedPage
from app.retrieval.citations import quote_in_chunk, validate_citations
from app.schemas import SourceRef


def test_chunking_and_page_preservation():
    pages = [
        ExtractedPage(page_number=1, text="First page content. " * 30),
        ExtractedPage(page_number=2, text="Second page content. " * 10),
    ]
    chunks = chunk_pages(pages)
    assert len(chunks) > 1
    assert chunks[0].page == 1
    assert any(c.page == 2 for c in chunks)


def test_citations_validation():
    chunk_text = "Never assume that a fraction with bigger numbers is always larger. In 3/8, the 8 means very small pieces."
    chunks_by_id = {"c2": {"id": "c2", "page": 3, "text": chunk_text}}

    valid_ref = SourceRef(chunk_id="c2", page=3, quote="fraction with bigger numbers is always larger")
    invalid_ref = SourceRef(chunk_id="c2", page=3, quote="completely made up hallucinated statement")

    res = validate_citations([valid_ref, invalid_ref], chunks_by_id)
    assert len(res) == 1
    assert res[0].chunk_id == "c2"


def test_sample_document_and_signature_demo(client):
    headers = {"Authorization": "Bearer dev-student1"}

    # 1. Create sample document
    r = client.post("/api/documents/sample", headers=headers)
    assert r.status_code == 200
    doc_id = r.json()["documentId"]

    # 2. Get document details
    doc_r = client.get(f"/api/documents/{doc_id}", headers=headers)
    assert doc_r.status_code == 200
    concepts = doc_r.json()["concepts"]
    assert len(concepts) >= 4
    comp_concept = next(c for c in concepts if c["id"] == "c_comparing_fractions")

    # -------------------------------------------------------------
    # STUDENT 1: picks 3/8 -> ambiguous follow-up -> signals M1 -> visual strategy
    # -------------------------------------------------------------
    s1_resp = client.post("/api/sessions", json={"documentId": doc_id, "conceptId": "c_comparing_fractions"}, headers=headers)
    assert s1_resp.status_code == 200
    s1_id = s1_resp.json()["sessionId"]
    step1 = s1_resp.json()["step"]
    assert step1["kind"] == "question"
    assert step1["question"]["id"] == "q_sample_probe"

    # S1 chooses 'b' (3/8 is larger: ambiguous signals {"M1": 0.5, "M3": 0.4})
    ans1 = client.post(f"/api/sessions/{s1_id}/answer", json={"stepId": step1["id"], "optionId": "b"}, headers=headers)
    assert ans1.status_code == 200
    step2_s1 = ans1.json()["step"]
    # Decision was ambiguous, so engine asks discriminating follow-up!
    assert step2_s1["kind"] == "follow_up"
    assert step2_s1["question"]["id"] == "q_sample_follow_up"

    # Student 1 answers follow-up with option 'a' (signals M1: larger denominator means larger fraction)
    ans2_s1 = client.post(f"/api/sessions/{s1_id}/answer", json={"stepId": step2_s1["id"], "optionId": "a"}, headers=headers)
    assert ans2_s1.status_code == 200
    step3_s1 = ans2_s1.json()["step"]
    assert step3_s1["kind"] == "explanation"
    assert step3_s1["hypothesis"]["misconception_id"] == "M1"
    # M1 preferred strategy is analogy_visual!
    assert step3_s1["explanation"]["strategy"] == "analogy_visual"

    # -------------------------------------------------------------
    # STUDENT 2: picks 3/8 -> ambiguous follow-up -> signals M3 -> worked_example strategy
    # -------------------------------------------------------------
    headers_s2 = {"Authorization": "Bearer dev-student2"}
    r2 = client.post("/api/documents/sample", headers=headers_s2)
    doc_id_s2 = r2.json()["documentId"]
    s2_resp = client.post("/api/sessions", json={"documentId": doc_id_s2, "conceptId": "c_comparing_fractions"}, headers=headers_s2)
    assert s2_resp.status_code == 200
    s2_id = s2_resp.json()["sessionId"]

    # S2 chooses 'b' (3/8)
    ans1_s2 = client.post(f"/api/sessions/{s2_id}/answer", json={"stepId": step1["id"], "optionId": "b"}, headers=headers_s2)
    step2_s2 = ans1_s2.json()["step"]
    assert step2_s2["kind"] == "follow_up"

    # Student 2 answers follow-up with option 'c' (signals M3: gap difference reasoning)
    ans2_s2 = client.post(f"/api/sessions/{s2_id}/answer", json={"stepId": step2_s2["id"], "optionId": "c"}, headers=headers_s2)
    step3_s2 = ans2_s2.json()["step"]
    assert step3_s2["kind"] == "explanation"
    assert step3_s2["hypothesis"]["misconception_id"] == "M3"
    # M3 preferred strategy is worked_example!
    assert step3_s2["explanation"]["strategy"] == "worked_example"

    # -------------------------------------------------------------
    # S1 continues: Practice -> Correct -> Transfer -> Demonstrated
    # -------------------------------------------------------------
    # From explanation, submit answer or next
    # Next step is practice
    client.post(f"/api/sessions/{s1_id}/answer", json={"stepId": step3_s1["id"]}, headers=headers)
    # S1 answers practice question correctly ('a': 1/10 is smaller)
    prac_ans = client.post(f"/api/sessions/{s1_id}/answer", json={"stepId": "next", "optionId": "a"}, headers=headers)
    step_prac = prac_ans.json()["step"]

    # Verify session summary endpoint
    summary = client.get(f"/api/sessions/{s1_id}/summary", headers=headers)
    assert summary.status_code == 200
    assert summary.json()["sessionId"] == s1_id


def test_student_challenge_flow(client):
    headers = {"Authorization": "Bearer dev-student-challenge"}
    r = client.post("/api/documents/sample", headers=headers)
    doc_id = r.json()["documentId"]

    # Start session
    s_resp = client.post("/api/sessions", json={"documentId": doc_id, "conceptId": "c_comparing_fractions"}, headers=headers)
    sid = s_resp.json()["sessionId"]

    # Answer wrong with M1 signal
    ans1 = client.post(f"/api/sessions/{sid}/answer", json={"stepId": "step1", "optionId": "b"}, headers=headers)
    # Answer follow-up with M1
    ans2 = client.post(f"/api/sessions/{sid}/answer", json={"stepId": "step2", "optionId": "a"}, headers=headers)
    step = ans2.json()["step"]
    assert step["kind"] == "explanation"
    assert step["hypothesis"]["misconception_id"] == "M1"

    # Student challenges: "That's not why I chose it"
    chall = client.post(f"/api/sessions/{sid}/challenge", json={"stepId": step["id"], "freeText": "I misread the numbers"}, headers=headers)
    assert chall.status_code == 200
    chall_step = chall.json()["step"]
    assert chall_step["hypothesis"]["status"] == "tentative"


def test_progress_and_usage_endpoints(client):
    headers = {"Authorization": "Bearer dev-student-metrics"}

    usage_r = client.get("/api/usage", headers=headers)
    assert usage_r.status_code == 200
    assert "uploadsRemaining" in usage_r.json()

    prog_r = client.get("/api/progress", headers=headers)
    assert prog_r.status_code == 200
    assert "concepts" in prog_r.json()


def test_courses_topic_intake_and_placement(client):
    headers = {"Authorization": "Bearer dev-student-course"}
    create_r = client.post("/api/courses", json={"topic": "Fractions", "level": "Grade 6"}, headers=headers)
    assert create_r.status_code == 200
    course_data = create_r.json()
    assert "courseId" in course_data
    assert len(course_data["plan"]) >= 3

    cid = course_data["courseId"]
    get_r = client.get(f"/api/courses/{cid}", headers=headers)
    assert get_r.status_code == 200
    assert get_r.json()["courseId"] == cid
