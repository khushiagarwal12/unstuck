from tests.conftest import make_client


def test_health_needs_no_auth():
    r = make_client(signed_in=False).get("/health")
    assert r.status_code == 200 and r.json()["ok"] is True


def test_protected_route_requires_a_bearer_token():
    client = make_client(signed_in=False)
    for headers in ({}, {"Authorization": "Basic abc"}):
        r = client.get("/api/me", headers=headers)
        assert r.status_code == 401
        err = r.json()["error"]
        assert err["code"] == "unauthenticated"
        assert set(err) == {"code", "message", "retryable"}


def test_missing_firebase_configuration_is_a_clear_503_not_a_bypass():
    r = make_client(signed_in=False).get("/api/me", headers={"Authorization": "Bearer anything"})
    assert r.status_code == 503
    assert r.json()["error"]["code"] == "auth_not_configured"


def test_signed_in_user_is_identified():
    assert make_client(uid="abc").get("/api/me").json() == {"uid": "abc"}


def test_validation_errors_do_not_echo_submitted_values():
    r = make_client().post("/api/diagnostics/roundtrip", json={"x": "super secret student text"})
    assert "super secret" not in r.text


def test_cors_allows_only_configured_origin():
    client = make_client(signed_in=False)
    ok = client.options("/health", headers={"Origin": "http://localhost:5173", "Access-Control-Request-Method": "GET"})
    assert ok.headers.get("access-control-allow-origin") == "http://localhost:5173"
    bad = client.options("/health", headers={"Origin": "https://evil.example", "Access-Control-Request-Method": "GET"})
    assert "access-control-allow-origin" not in bad.headers
