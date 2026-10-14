from app.core.state_machine import (
    State,
    after_follow_up,
    after_practice,
    after_probe,
    after_transfer,
)


def test_correct_probe_goes_to_transfer_check():
    assert after_probe(is_correct=True, hypothesis_accepted=False, follow_up_count=0) == State.TRANSFER


def test_wrong_probe_clear_hypothesis_explains():
    assert after_probe(is_correct=False, hypothesis_accepted=True, follow_up_count=0) == State.EXPLAIN


def test_wrong_probe_ambiguous_follows_up_then_gives_up_after_two():
    assert after_probe(is_correct=False, hypothesis_accepted=False, follow_up_count=0) == State.FOLLOW_UP
    assert after_follow_up(hypothesis_accepted=False, follow_up_count=1) == State.FOLLOW_UP
    assert after_follow_up(hypothesis_accepted=False, follow_up_count=2) == State.EXPLAIN
    assert after_follow_up(hypothesis_accepted=True, follow_up_count=1) == State.EXPLAIN


def test_transfer_outcomes():
    kw = dict(hypothesis_accepted=False, follow_up_count=0)
    assert after_transfer(is_correct=True, status="demonstrated", **kw) == State.SUMMARY
    assert after_transfer(is_correct=True, status="developing", **kw) == State.PRACTICE
    assert after_transfer(is_correct=False, status="developing", **kw) == State.FOLLOW_UP


def test_practice_loop_and_exit():
    base = dict(prereq_done=False)
    assert after_practice(is_correct=True, status="demonstrated", cycle_count=1, **base) == State.SUMMARY
    assert after_practice(is_correct=True, status="developing", cycle_count=1, **base) == State.PRACTICE
    assert after_practice(is_correct=False, status="developing", cycle_count=1, **base) == State.EXPLAIN
    assert after_practice(is_correct=False, status="developing", cycle_count=3, **base) == State.PREREQ_REVIEW
    assert (
        after_practice(is_correct=False, status="developing", cycle_count=3, prereq_done=True)
        == State.SUMMARY
    )
