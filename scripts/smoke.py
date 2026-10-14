#!/usr/bin/env python3
"""End-to-end check against a running backend (local or deployed). Standard library only.

It signs in anonymously through Firebase's REST API, then calls the real API. Nothing is simulated:
the model call hits Gemini and the write hits Firestore. Run it after Day 0 setup, and again after
each deploy.

  SMOKE_FIREBASE_API_KEY=...  [SMOKE_API_URL=http://localhost:8000]  python scripts/smoke.py

Set ENABLE_DIAGNOSTICS=true on the backend to include the Gemini + Firestore round trip. It spends a
little free-tier quota, so keep that flag off on a public host.
"""

from __future__ import annotations

import json
import os
import sys
import urllib.error
import urllib.request

API = os.environ.get("SMOKE_API_URL", "http://localhost:8000").rstrip("/")
FIREBASE_KEY = os.environ.get("SMOKE_FIREBASE_API_KEY", "")


def call(method: str, url: str, *, token: str | None = None, body: dict | None = None, timeout: float = 90):
    data = json.dumps(body).encode() if body is not None else None
    headers = {"Content-Type": "application/json"} if body is not None else {}
    if token:
        headers["Authorization"] = f"Bearer {token}"
    req = urllib.request.Request(url, data=data, headers=headers, method=method)
    try:
        with urllib.request.urlopen(req, timeout=timeout) as r:
            return r.status, json.loads(r.read() or b"{}")
    except urllib.error.HTTPError as e:
        try:
            return e.code, json.loads(e.read() or b"{}")
        except ValueError:
            return e.code, {}
    except urllib.error.URLError as e:
        return 0, {"error": {"code": "unreachable", "message": str(e.reason)}}


results: list[tuple[str, str, str]] = []


def record(name: str, ok: bool | None, detail: str = "") -> None:
    results.append((name, {True: "PASS", False: "FAIL", None: "SKIP"}[ok], detail))


def main() -> int:
    # 1. Backend reachable (a sleeping free host can take about a minute to answer)
    status, body = call("GET", f"{API}/health", timeout=120)
    record("backend /health", status == 200 and body.get("ok") is True, f"HTTP {status}")
    if status != 200:
        return report()

    # 2. Anonymous Firebase sign-in
    if not FIREBASE_KEY:
        record("firebase sign-in", None, "set SMOKE_FIREBASE_API_KEY (Firebase web API key)")
        return report()
    status, body = call(
        "POST",
        f"https://identitytoolkit.googleapis.com/v1/accounts:signUp?key={FIREBASE_KEY}",
        body={"returnSecureToken": True},
    )
    token = body.get("idToken")
    record("firebase anonymous sign-in", bool(token), f"HTTP {status}" if not token else "")
    if not token:
        return report()

    # 3. The backend accepts that token
    status, body = call("GET", f"{API}/api/me", token=token)
    record("backend accepts the Firebase token", status == 200 and bool(body.get("uid")), f"HTTP {status} {body.get('error', {}).get('code', '')}".strip())

    # 4. Usage limits read from Firestore
    status, body = call("GET", f"{API}/api/usage", token=token)
    record("daily usage (Firestore read)", status == 200 and "llm_calls" in body, f"HTTP {status}")

    # 5. Gemini structured output + Firestore write
    status, body = call("POST", f"{API}/api/diagnostics/roundtrip", token=token)
    if status == 404:
        record("gemini + firestore round trip", None, "diagnostics disabled (set ENABLE_DIAGNOSTICS=true)")
    else:
        ok = status == 200 and body.get("stored") is True
        err = body.get("error", {})
        record("gemini + firestore round trip", ok, f"HTTP {status} {err.get('code', '')}".strip())
    return report()


def report() -> int:
    width = max(len(n) for n, _, _ in results)
    for name, outcome, detail in results:
        print(f"{outcome:<5} {name:<{width}}  {detail}")
    return 1 if any(o == "FAIL" for _, o, _ in results) else 0


if __name__ == "__main__":
    sys.exit(main())
