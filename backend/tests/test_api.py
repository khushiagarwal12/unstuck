def test_health_needs_no_auth(client):
    r = client.get("/health")
    assert r.status_code == 200
    assert r.json()["ok"] is True


def test_protected_route_requires_token(client):
    r = client.get("/api/me")
    assert r.status_code == 401
    err = r.json()["error"]
    assert err["code"] == "unauthenticated"
    assert set(err) == {"code", "message", "retryable"}


def test_dev_token_round_trip(client):
    r = client.get("/api/me", headers={"Authorization": "Bearer dev-student42"})
    assert r.status_code == 200
    assert r.json() == {"uid": "student42"}


def test_malformed_tokens_rejected(client):
    for h in ("Bearer nope", "Bearer dev-", "Basic abc"):
        assert client.get("/api/me", headers={"Authorization": h}).status_code == 401


def test_firebase_mode_without_config_is_a_clear_503():
    from fastapi.testclient import TestClient

    from app.config import Settings, get_settings
    from app.main import create_app

    app = create_app()
    app.dependency_overrides[get_settings] = lambda: Settings(auth_mode="firebase")
    r = TestClient(app, raise_server_exceptions=False).get("/api/me", headers={"Authorization": "Bearer x"})
    assert r.status_code == 503
    assert r.json()["error"]["code"] == "auth_not_configured"


def test_cors_allows_only_configured_origin(client):
    ok = client.options(
        "/health",
        headers={"Origin": "http://localhost:5173", "Access-Control-Request-Method": "GET"},
    )
    assert ok.headers.get("access-control-allow-origin") == "http://localhost:5173"
    bad = client.options(
        "/health",
        headers={"Origin": "https://evil.example", "Access-Control-Request-Method": "GET"},
    )
    assert "access-control-allow-origin" not in bad.headers
