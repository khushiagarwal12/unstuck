from app.core.policy import choose_strategy, validate_strategies


def test_validate_drops_unknown_and_repeats():
    assert validate_strategies(["worked_example", "magic", "worked_example", "hint"]) == [
        "worked_example",
        "hint",
    ]


def test_picks_first_preferred_not_tried():
    pref = ["analogy_visual", "worked_example"]
    assert choose_strategy(pref, [], tentative=False, failed_cycles=0) == "analogy_visual"
    assert choose_strategy(pref, ["analogy_visual"], tentative=False, failed_cycles=1) == "worked_example"


def test_never_repeats_a_tried_strategy():
    pref = ["analogy_visual"]
    got = choose_strategy(pref, ["analogy_visual"], tentative=False, failed_cycles=1)
    assert got != "analogy_visual" and got is not None


def test_prerequisite_review_after_two_failures():
    got = choose_strategy(["worked_example"], ["simplified", "worked_example"], tentative=False, failed_cycles=2)
    assert got == "prerequisite_review"


def test_tentative_diagnosis_starts_low_commitment():
    assert choose_strategy(["analogy_visual", "hint"], [], tentative=True, failed_cycles=0) == "hint"
    assert choose_strategy(["analogy_visual"], [], tentative=True, failed_cycles=0) == "simplified"


def test_exhausted_returns_none():
    allv = ["hint", "simplified", "worked_example", "analogy_visual", "prerequisite_review"]
    assert choose_strategy(allv, allv, tentative=False, failed_cycles=5) is None
