import asyncio

import pytest

from app.config import Settings
from app.errors import AppError
from app.usage import UsageGuard, is_judge
from tests.fakes import MemoryStore


def run(coro):
    return asyncio.run(coro)


def guard(store=None, day=None, **cfg):
    settings = Settings(
        daily_llm_calls_per_user=cfg.pop("llm", 2),
        daily_uploads_per_user=cfg.pop("uploads", 1),
        daily_llm_calls_global=cfg.pop("global_cap", 100),
        judge_code=cfg.pop("judge", "open-sesame"),
        judge_cap_multiplier=5,
    )
    store = store or MemoryStore()
    today = (lambda: day[0]) if day else (lambda: "2026-10-14")
    return UsageGuard(store, settings, today=today), store


def test_user_cap_blocks_with_a_clear_message():
    g, _ = guard()
    run(g.charge("u1", "llm_calls")); run(g.charge("u1", "llm_calls"))
    with pytest.raises(AppError) as exc:
        run(g.charge("u1", "llm_calls"))
    assert exc.value.code == "quota_exceeded" and exc.value.status == 429
    assert "tomorrow" in exc.value.message


def test_caps_are_per_user_and_per_kind():
    g, _ = guard()
    run(g.charge("u1", "llm_calls")); run(g.charge("u1", "llm_calls"))
    run(g.charge("u2", "llm_calls"))   # another user is unaffected
    run(g.charge("u1", "uploads"))     # another kind is unaffected


def test_a_refused_charge_is_not_recorded():
    g, store = guard()
    run(g.charge("u1", "uploads"))
    with pytest.raises(AppError):
        run(g.charge("u1", "uploads"))
    assert run(g.snapshot("u1"))["uploads"]["used"] == 1


def test_judge_code_raises_the_caps():
    g, _ = guard()
    assert g.cap("llm_calls") == 2 and g.cap("llm_calls", judge=True) == 10
    for _ in range(10):
        run(g.charge("u1", "llm_calls", judge=True))
    with pytest.raises(AppError):
        run(g.charge("u1", "llm_calls", judge=True))


def test_global_budget_switches_to_sample_only_without_charging_anyone():
    g, _ = guard(global_cap=2, llm=5)
    run(g.charge("u1", "llm_calls")); run(g.charge("u2", "llm_calls"))
    with pytest.raises(AppError) as exc:
        run(g.charge("u3", "llm_calls"))
    assert exc.value.code == "sample_only"
    snap = run(g.snapshot("u3"))
    assert snap["sample_only"] is True and snap["llm_calls"]["used"] == 0


def test_allowance_resets_on_a_new_day():
    day = ["2026-10-14"]
    g, _ = guard(day=day)
    run(g.charge("u1", "uploads"))
    day[0] = "2026-10-15"
    run(g.charge("u1", "uploads"))


def test_is_judge_requires_an_exact_non_empty_code():
    s = Settings(judge_code="open-sesame")
    assert is_judge(s, "open-sesame")
    assert not is_judge(s, "open-sesam") and not is_judge(s, None) and not is_judge(s, "")
    assert not is_judge(Settings(judge_code=""), "")
