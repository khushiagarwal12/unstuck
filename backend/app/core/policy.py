"""Teaching-strategy policy (ARCHITECTURE.md section 3.4). Deterministic; no model involved."""

from __future__ import annotations

from typing import Literal, Sequence

Strategy = Literal["hint", "simplified", "worked_example", "analogy_visual", "prerequisite_review"]

ALL_STRATEGIES: tuple[Strategy, ...] = (
    "hint",
    "simplified",
    "worked_example",
    "analogy_visual",
    "prerequisite_review",
)
LOW_COMMITMENT: tuple[Strategy, ...] = ("hint", "simplified")
PREREQ_AFTER_FAILURES = 2


def validate_strategies(candidates: Sequence[str]) -> list[Strategy]:
    """Keep only allowed strategies, in order, without repeats (used on model-proposed lists)."""
    allowed = set(ALL_STRATEGIES)
    seen: list[Strategy] = []
    for c in candidates:
        if c in allowed and c not in seen:
            seen.append(c)  # type: ignore[arg-type]
    return seen


def choose_strategy(
    preferred: Sequence[str],
    tried: Sequence[str],
    *,
    tentative: bool,
    failed_cycles: int,
) -> Strategy | None:
    """Pick the next teaching strategy, or None when every option has been used.

    Rules: never repeat a strategy that was already tried; after two failed cycles fall back to
    prerequisite review; while the diagnosis is only tentative, start with a low-commitment
    strategy (hint or simplified explanation).
    """
    tried_set = set(tried)
    ordered = validate_strategies(preferred)

    if failed_cycles >= PREREQ_AFTER_FAILURES and "prerequisite_review" not in tried_set:
        return "prerequisite_review"

    if tentative and not tried_set:
        for s in ordered:
            if s in LOW_COMMITMENT:
                return s
        return "simplified"

    for s in ordered:
        if s not in tried_set:
            return s
    for s in ALL_STRATEGIES:
        if s not in tried_set:
            return s
    return None
