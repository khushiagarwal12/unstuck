"""Evaluation runner with simulated student (ARCHITECTURE.md section 14).

Runs test cases against the learning loop, tracks diagnosis top-1 agreement,
strategy appropriateness, and prints a formatted benchmark table for the pitch.
"""

from __future__ import annotations

import json
import sys
from pathlib import Path

# Add backend to path
sys.path.insert(0, str(Path(__file__).parent.parent / "backend"))

from app.config import Settings, get_settings
from app.main import create_app
from fastapi.testclient import TestClient


def run_evaluations() -> bool:
    cases_file = Path(__file__).parent / "fractions_cases.json"
    if not cases_file.exists():
        print(f"Error: {cases_file} not found")
        return False

    with open(cases_file, "r", encoding="utf-8") as f:
        cases = json.load(f)

    app = create_app()
    app.dependency_overrides[get_settings] = lambda: Settings(auth_mode="dev", llm_backend="fake")
    client = TestClient(app, raise_server_exceptions=False)

    print(f"\n{'='*75}")
    print(f"{'UNSTUCK Learning Loop Evaluation Harness':^75}")
    print(f"{'='*75}")
    print(f"{'Case ID':<35} | {'Intended':<8} | {'Diagnosed':<9} | {'Strategy':<14} | Result")
    print(f"{'-'*75}")

    all_passed = True
    for case in cases:
        cid = case["id"]
        headers = {"Authorization": f"Bearer dev-{cid}"}

        # 1. Clone sample document
        r = client.post("/api/documents/sample", headers=headers)
        doc_id = r.json()["documentId"]

        # 2. Start session
        s_res = client.post("/api/sessions", json={"documentId": doc_id, "conceptId": case["concept_id"]}, headers=headers)
        if s_res.status_code != 200:
            print(f"{cid:<35} | FAIL: could not create session ({s_res.status_code})")
            all_passed = False
            continue

        sid = s_res.json()["sessionId"]
        step = s_res.json()["step"]

        diagnosed = "NONE"
        strategy_used = "-"

        for ans in case["answers"]:
            res = client.post(f"/api/sessions/{sid}/answer", json={"stepId": step["id"], "optionId": ans}, headers=headers)
            step = res.json().get("step", {})
            hyp = step.get("hypothesis")
            if hyp:
                diagnosed = hyp.get("misconception_id", "NONE")
            exp = step.get("explanation")
            if exp:
                strategy_used = exp.get("strategy", "-")

        exp_diag = case["expected_diagnosis"]
        diag_match = (diagnosed == exp_diag)

        exp_strat = case.get("expected_strategy")
        strat_match = True
        if exp_strat:
            strat_match = (strategy_used == exp_strat)

        status = "PASS" if (diag_match and strat_match) else "FAIL"
        if status == "FAIL":
            all_passed = False

        print(f"{cid:<35} | {exp_diag:<8} | {diagnosed:<9} | {strategy_used:<14} | {status}")

    print(f"{'='*75}")
    print(f"Overall Benchmark: {'ALL TESTS PASSED' if all_passed else 'SOME TESTS FAILED'}\n")
    return all_passed


if __name__ == "__main__":
    success = run_evaluations()
    sys.exit(0 if success else 1)
