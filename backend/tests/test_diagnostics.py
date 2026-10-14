from app.config import Settings
from tests.conftest import make_client
from tests.fakes import MemoryStore, ScriptedLLM


def setup(**cfg):
    llm = ScriptedLLM().queue({"message": "pong"})
    store = MemoryStore()
    client = make_client(settings=Settings(enable_diagnostics=cfg.pop("on", True), **cfg), llm=llm, store=store)
    return client, llm, store


def test_roundtrip_calls_the_model_and_persists_the_reply():
    client, llm, store = setup()
    r = client.post("/api/diagnostics/roundtrip")
    assert r.status_code == 200
    assert r.json() == {"uid": "student42", "model_reply": "pong", "stored": True}
    assert store.paths("diagnostics/") == ["diagnostics/student42"]
    assert llm.calls[0]["tier"] == "fast"


def test_roundtrip_is_hidden_unless_enabled():
    client, llm, _ = setup(on=False)
    assert client.post("/api/diagnostics/roundtrip").status_code == 404
    assert llm.calls == []


def test_roundtrip_respects_the_daily_limit_before_calling_the_model():
    client, llm, _ = setup(daily_llm_calls_per_user=0)
    r = client.post("/api/diagnostics/roundtrip")
    assert r.status_code == 429 and r.json()["error"]["code"] == "quota_exceeded"
    assert llm.calls == []


def test_usage_endpoint_reports_allowance_and_judge_code_raises_it():
    client, _, _ = setup(daily_llm_calls_per_user=10, daily_uploads_per_user=3, judge_code="open-sesame")
    base = client.get("/api/usage").json()
    assert base["llm_calls"] == {"used": 0, "cap": 10} and base["uploads"]["cap"] == 3
    judge = client.get("/api/usage", headers={"X-Judge-Code": "open-sesame"}).json()
    assert judge["llm_calls"]["cap"] == 50
    wrong = client.get("/api/usage", headers={"X-Judge-Code": "nope"}).json()
    assert wrong["llm_calls"]["cap"] == 10
