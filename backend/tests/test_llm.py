import asyncio

import pytest
from pydantic import BaseModel

from app.errors import AppError
from app.llm.client import BaseLLM
from tests.fakes import ScriptedLLM
from app.llm.quota import TokenBucket


class Verdict(BaseModel):
    answer: str
    score: int


def run(coro):
    return asyncio.run(coro)


def test_valid_reply_is_parsed():
    llm = ScriptedLLM().queue({"answer": "a", "score": 3})
    got = run(llm.generate_structured(prompt="p", schema=Verdict))
    assert got == Verdict(answer="a", score=3)


def test_invalid_reply_gets_one_retry_that_mentions_the_problem():
    llm = ScriptedLLM().queue("not json", {"answer": "b", "score": 1})
    got = run(llm.generate_structured(prompt="p", schema=Verdict))
    assert got.answer == "b"
    assert len(llm.calls) == 2
    assert "did not match the required JSON schema" in llm.calls[1]["prompt"]


def test_two_invalid_replies_raise_a_retryable_error():
    llm = ScriptedLLM().queue("nope", '{"answer": 5}')
    with pytest.raises(AppError) as exc:
        run(llm.generate_structured(prompt="p", schema=Verdict))
    assert exc.value.code == "model_invalid_output" and exc.value.retryable


def test_provider_failure_is_mapped_without_leaking_details():
    class Boom(BaseLLM):
        async def _generate_json(self, **_):
            raise ConnectionError("secret internal detail")

    with pytest.raises(AppError) as exc:
        run(Boom(timeout=1, rpm_main=60, rpm_fast=60).generate_structured(prompt="p", schema=Verdict))
    assert exc.value.code == "model_unavailable"
    assert "secret" not in exc.value.message


def test_timeout_is_mapped():
    class Slow(BaseLLM):
        async def _generate_json(self, **_):
            await asyncio.sleep(1)
            return "{}"

    with pytest.raises(AppError) as exc:
        run(Slow(timeout=0.01, rpm_main=60, rpm_fast=60).generate_structured(prompt="p", schema=Verdict))
    assert exc.value.code == "model_timeout"


def test_rate_limit_returns_busy_instead_of_calling_the_provider():
    llm = ScriptedLLM(rpm_main=1).queue({"answer": "a", "score": 1}, {"answer": "b", "score": 2})
    run(llm.generate_structured(prompt="p", schema=Verdict))
    with pytest.raises(AppError) as exc:
        run(llm.generate_structured(prompt="p", schema=Verdict))
    assert exc.value.code == "busy" and exc.value.retryable
    assert len(llm.calls) == 1


def test_token_bucket_refills_over_time():
    now = [0.0]
    bucket = TokenBucket(2, clock=lambda: now[0])
    assert bucket.try_take() and bucket.try_take()
    assert not bucket.try_take()
    assert bucket.seconds_until_available() == pytest.approx(30.0)
    now[0] += 31
    assert bucket.try_take()


def test_token_bucket_rejects_nonpositive_rate():
    with pytest.raises(ValueError):
        TokenBucket(0)
