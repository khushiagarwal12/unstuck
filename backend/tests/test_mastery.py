from app.core.mastery import Attempt, derive_status


def A(qid, tag, ok=True, hint=False, after=False, scored=True):
    return Attempt(qid, tag, ok, hint, after, scored)


def test_no_attempts_is_not_assessed():
    assert derive_status([]) == "not_assessed"
    assert derive_status([A("q1", "t1", scored=False)]) == "not_assessed"


def test_one_correct_answer_is_never_demonstrated():
    assert derive_status([A("q1", "pizza")]) == "developing"


def test_two_clean_transfer_successes_without_errors_demonstrate():
    assert derive_status([A("q1", "pizza"), A("q2", "ribbon")]) == "demonstrated"


def test_same_question_or_same_context_does_not_count():
    assert derive_status([A("q1", "pizza"), A("q1", "ribbon")]) == "developing"
    assert derive_status([A("q1", "pizza"), A("q2", "pizza")]) == "developing"


def test_hint_use_blocks_demonstration():
    assert derive_status([A("q1", "pizza"), A("q2", "ribbon", hint=True)]) == "developing"


def test_after_error_needs_a_success_after_remediation():
    history = [A("q1", "pizza", ok=False), A("q2", "ribbon"), A("q3", "tape")]
    assert derive_status(history) == "developing"
    history = [A("q1", "pizza", ok=False), A("q2", "ribbon", after=True), A("q3", "tape")]
    assert derive_status(history) == "demonstrated"


def test_later_failure_demotes():
    history = [A("q1", "pizza"), A("q2", "ribbon"), A("q3", "tape", ok=False)]
    assert derive_status(history) == "developing"


def test_unscored_follow_ups_are_ignored():
    history = [A("q1", "pizza"), A("f1", "x", ok=False, scored=False), A("q2", "ribbon")]
    assert derive_status(history) == "demonstrated"
