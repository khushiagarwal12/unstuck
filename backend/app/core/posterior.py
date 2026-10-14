"""Hypothesis tracking over a concept's misconception catalog.

Pure functions, no I/O (ARCHITECTURE.md section 3.3). The posterior is a dict of
hypothesis id -> probability, and always includes NONE (a slip, or no misconception).
Probabilities come from evidence updates here, never from the model's self-reported confidence.
"""

from __future__ import annotations

from dataclasses import dataclass
from typing import Literal, Mapping

NONE = "NONE"

PRIOR_NONE = 0.2
LIKE_CORRECT_MISCONCEPTION = 0.2
LIKE_CORRECT_NONE = 0.9
LIKE_WRONG_UNLISTED = 0.05
LIKE_WRONG_NONE = 0.1

ACCEPT_MIN_PROB = 0.60
ACCEPT_MIN_MARGIN = 0.25
CHALLENGE_FACTOR = 0.2

Reading = Literal["supports", "contradicts", "unclear"]
READING_MULTIPLIER: dict[str, float] = {"supports": 3.0, "contradicts": 0.25, "unclear": 1.0}


def normalize(weights: Mapping[str, float]) -> dict[str, float]:
    total = sum(weights.values())
    if total <= 0:
        raise ValueError("posterior weights must have a positive sum")
    return {k: v / total for k, v in weights.items()}


def init_posterior(misconception_ids: list[str]) -> dict[str, float]:
    """Uniform over misconceptions, with NONE fixed at PRIOR_NONE before normalizing."""
    ids = list(dict.fromkeys(misconception_ids))  # de-duplicate, keep order
    if NONE in ids:
        raise ValueError(f"{NONE!r} is reserved")
    if not ids:
        return {NONE: 1.0}
    share = (1.0 - PRIOR_NONE) / len(ids)
    weights = {m: share for m in ids}
    weights[NONE] = PRIOR_NONE
    return normalize(weights)


def update_on_answer(
    posterior: Mapping[str, float],
    *,
    is_correct: bool,
    option_signals: Mapping[str, float] | None = None,
) -> dict[str, float]:
    """Bayesian update after a multiple-choice answer.

    option_signals is the chosen option's P(choose | misconception) map (server-only data).
    """
    signals = option_signals or {}
    updated: dict[str, float] = {}
    for h, prior in posterior.items():
        if h == NONE:
            like = LIKE_CORRECT_NONE if is_correct else LIKE_WRONG_NONE
        elif is_correct:
            like = LIKE_CORRECT_MISCONCEPTION
        else:
            like = signals.get(h, LIKE_WRONG_UNLISTED)
        updated[h] = prior * like
    return normalize(updated)


def update_on_justification(
    posterior: Mapping[str, float], readings: Mapping[str, Reading]
) -> dict[str, float]:
    """Update from a free-text 'why did you pick that?' that the model mapped onto the catalog."""
    updated = {
        h: p * READING_MULTIPLIER.get(readings.get(h, "unclear"), 1.0)
        for h, p in posterior.items()
    }
    return normalize(updated)


def apply_challenge(posterior: Mapping[str, float], misconception_id: str) -> dict[str, float]:
    """Student says 'that's not why I chose it': penalize that hypothesis, renormalize."""
    if misconception_id not in posterior:
        raise KeyError(misconception_id)
    updated = dict(posterior)
    updated[misconception_id] *= CHALLENGE_FACTOR
    return normalize(updated)


@dataclass(frozen=True)
class Decision:
    top_id: str
    top_prob: float
    second_id: str | None
    second_prob: float
    accepted: bool  # strong enough to act on without another question


def decide(posterior: Mapping[str, float]) -> Decision:
    """Accept the leading hypothesis only if it is both probable and clearly ahead."""
    ranked = sorted(posterior.items(), key=lambda kv: kv[1], reverse=True)
    top_id, top_prob = ranked[0]
    second_id, second_prob = ranked[1] if len(ranked) > 1 else (None, 0.0)
    accepted = (
        top_id != NONE
        and top_prob >= ACCEPT_MIN_PROB
        and (top_prob - second_prob) >= ACCEPT_MIN_MARGIN
    )
    return Decision(top_id, top_prob, second_id, second_prob, accepted)
