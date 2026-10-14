"""Concept mastery, derived only from recorded attempts (ARCHITECTURE.md section 3.5).

The model never sets mastery. A single correct answer never yields 'demonstrated'.
"""

from __future__ import annotations

from dataclasses import dataclass
from typing import Literal, Sequence

MasteryStatus = Literal["not_assessed", "developing", "demonstrated"]


@dataclass(frozen=True)
class Attempt:
    question_id: str
    context_tag: str
    is_correct: bool
    hint_used: bool = False
    after_remediation: bool = False  # answered after an explanation was shown
    scored: bool = True  # diagnostic follow-ups can be recorded but not scored


def derive_status(attempts: Sequence[Attempt]) -> MasteryStatus:
    """attempts are in chronological order."""
    scored = [a for a in attempts if a.scored]
    if not scored:
        return "not_assessed"
    if len(scored) < 2:
        return "developing"

    last_two = scored[-2:]
    earlier = scored[:-2]

    if not all(a.is_correct and not a.hint_used for a in last_two):
        return "developing"
    if last_two[0].question_id == last_two[1].question_id:
        return "developing"
    if last_two[0].context_tag == last_two[1].context_tag:
        return "developing"

    # If the student ever got it wrong, at least one of the two clean successes must come
    # after remediation. With no earlier error, two clean transfer successes are enough.
    ever_wrong = any(not a.is_correct for a in earlier)
    if ever_wrong and not any(a.after_remediation for a in last_two):
        return "developing"
    return "demonstrated"
