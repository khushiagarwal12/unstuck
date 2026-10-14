import math

import pytest

from app.core import posterior as P


def test_init_is_normalized_with_none_prior():
    post = P.init_posterior(["M1", "M2", "M3"])
    assert math.isclose(sum(post.values()), 1.0)
    assert math.isclose(post[P.NONE], P.PRIOR_NONE)
    assert math.isclose(post["M1"], post["M2"])


def test_init_rejects_reserved_id_and_handles_empty():
    with pytest.raises(ValueError):
        P.init_posterior(["NONE"])
    assert P.init_posterior([]) == {P.NONE: 1.0}


def test_init_deduplicates():
    assert set(P.init_posterior(["M1", "M1", "M2"])) == {"M1", "M2", P.NONE}


def test_correct_answer_favours_none():
    start = P.init_posterior(["M1", "M2"])
    post = P.update_on_answer(start, is_correct=True)
    # One correct answer is weak evidence (it could be a guess), but NONE should lead.
    assert post[P.NONE] > start[P.NONE]
    assert P.decide(post).top_id == P.NONE
    assert math.isclose(sum(post.values()), 1.0)


def test_wrong_answer_with_clear_signal_accepts_hypothesis():
    post = P.init_posterior(["M1", "M2"])
    post = P.update_on_answer(post, is_correct=False, option_signals={"M1": 0.8})
    d = P.decide(post)
    assert d.top_id == "M1"
    assert d.accepted


def test_none_is_never_accepted_as_a_misconception():
    post = P.update_on_answer(P.init_posterior(["M1"]), is_correct=True)
    d = P.decide(post)
    assert d.top_id == P.NONE
    assert not d.accepted


def test_same_wrong_option_stays_ambiguous_then_follow_up_separates():
    """The signature demo: one wrong option is plausible under two misconceptions."""
    start = P.init_posterior(["M1", "M3"])
    ambiguous = P.update_on_answer(start, is_correct=False, option_signals={"M1": 0.5, "M3": 0.4})
    assert not P.decide(ambiguous).accepted

    # Student A's follow-up answer points to M1; student B's points to M3.
    a = P.update_on_answer(ambiguous, is_correct=False, option_signals={"M1": 0.8, "M3": 0.05})
    b = P.update_on_answer(ambiguous, is_correct=False, option_signals={"M3": 0.8, "M1": 0.05})
    assert P.decide(a).accepted and P.decide(a).top_id == "M1"
    assert P.decide(b).accepted and P.decide(b).top_id == "M3"


def test_justification_readings_shift_probability():
    post = P.init_posterior(["M1", "M2"])
    after = P.update_on_justification(post, {"M1": "supports", "M2": "contradicts"})
    assert after["M1"] > post["M1"]
    assert after["M2"] < post["M2"]
    assert math.isclose(sum(after.values()), 1.0)


def test_missing_reading_defaults_to_unclear():
    post = P.init_posterior(["M1", "M2"])
    assert P.update_on_justification(post, {}) == pytest.approx(post)


def test_challenge_lowers_that_hypothesis():
    post = P.update_on_answer(
        P.init_posterior(["M1", "M2"]), is_correct=False, option_signals={"M1": 0.8, "M2": 0.2}
    )
    challenged = P.apply_challenge(post, "M1")
    assert challenged["M1"] < post["M1"]
    assert math.isclose(sum(challenged.values()), 1.0)
    with pytest.raises(KeyError):
        P.apply_challenge(post, "nope")


def test_weights_must_be_positive():
    with pytest.raises(ValueError):
        P.normalize({"a": 0.0})
