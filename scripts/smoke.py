"""Smoke test against deployed or local backend (ARCHITECTURE.md rule 9 & section 15).

Usage:
  python scripts/smoke.py [BASE_URL]
Default: http://localhost:8000
"""

from __future__ import annotations

import sys
import httpx

BASE_URL = sys.argv[1] if len(sys.argv) > 1 else "http://localhost:8000"
BASE_URL = BASE_URL.rstrip("/")


def run_smoke():
    print(f"Running smoke test against: {BASE_URL}")

    # 1. Health check (no auth)
    print("1. Checking /health...")
    with httpx.Client(timeout=10.0) as client:
        r = client.get(f"{BASE_URL}/health")
        assert r.status_code == 200, f"Health check failed: {r.status_code}"
        data = r.json()
        assert data.get("ok") is True
        print(f"   OK: version {data.get('version')}")

    # 2. Protected round trip (/api/me)
    print("2. Checking dev auth round-trip (/api/me)...")
    headers = {"Authorization": "Bearer dev-smokestudent"}
    with httpx.Client(timeout=10.0) as client:
        r = client.get(f"{BASE_URL}/api/me", headers=headers)
        assert r.status_code == 200, f"Auth failed: {r.status_code}"
        assert r.json().get("uid") == "smokestudent"
        print("   OK: authenticated as smokestudent")

    # 3. Create sample document
    print("3. Creating sample document (/api/documents/sample)...")
    with httpx.Client(timeout=10.0) as client:
        r = client.post(f"{BASE_URL}/api/documents/sample", headers=headers)
        assert r.status_code == 200, f"Create sample failed: {r.status_code}"
        doc_id = r.json().get("documentId")
        print(f"   OK: documentId {doc_id}")

    # 4. Fetch document concepts
    print(f"4. Polling document {doc_id}...")
    with httpx.Client(timeout=10.0) as client:
        r = client.get(f"{BASE_URL}/api/documents/{doc_id}", headers=headers)
        assert r.status_code == 200
        concepts = r.json().get("concepts", [])
        assert len(concepts) > 0, "No concepts returned"
        print(f"   OK: found {len(concepts)} concepts")

    # 5. Start learning session
    print("5. Starting session on Comparing Fractions...")
    with httpx.Client(timeout=10.0) as client:
        r = client.post(
            f"{BASE_URL}/api/sessions",
            json={"documentId": doc_id, "conceptId": "c_comparing_fractions"},
            headers=headers,
        )
        assert r.status_code == 200, f"Start session failed: {r.status_code}"
        sid = r.json().get("sessionId")
        step = r.json().get("step")
        assert step.get("kind") == "question"
        print(f"   OK: session {sid} ready on probe question")

    # 6. Answer question
    print("6. Answering probe question...")
    with httpx.Client(timeout=10.0) as client:
        r = client.post(
            f"{BASE_URL}/api/sessions/{sid}/answer",
            json={"stepId": step["id"], "optionId": "b"},
            headers=headers,
        )
        assert r.status_code == 200
        next_step = r.json().get("step")
        assert next_step.get("kind") in ("follow_up", "explanation")
        print(f"   OK: transition to {next_step.get('kind')}")

    # 7. Check usage
    print("7. Checking quota (/api/usage)...")
    with httpx.Client(timeout=10.0) as client:
        r = client.get(f"{BASE_URL}/api/usage", headers=headers)
        assert r.status_code == 200
        print(f"   OK: uploads remaining {r.json().get('uploadsRemaining')}")

    print("\nALL SMOKE TESTS PASSED SUCCESSFULLY! BACKEND IS OPERATIONAL.")


if __name__ == "__main__":
    try:
        run_smoke()
    except Exception as exc:
        print(f"\nSMOKE TEST FAILED: {exc}")
        sys.exit(1)
