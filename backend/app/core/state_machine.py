"""Learning-loop transitions (ARCHITECTURE.md section 3.2).

Pure functions that answer one question: given what just happened, which state is next?
The backend calls these, then asks the model to generate content for the chosen state.
The model never chooses the state.
"""

from __future__ import annotations

from enum import Enum

from .mastery import MasteryStatus

MAX_FOLLOW_UPS = 2
MAX_CYCLES = 3


class State(str, Enum):
    PROBE = "probe"
    FOLLOW_UP = "follow_up"
    EXPLAIN = "explain"
    PRACTICE = "practice"
    TRANSFER = "transfer"
    PREREQ_REVIEW = "prereq_review"
    SUMMARY = "summary"


def after_wrong_answer(*, hypothesis_accepted: bool, follow_up_count: int) -> State:
    """A wrong probe or transfer answer. Ask a discriminating question while the cause is unclear."""
    if hypothesis_accepted:
        return State.EXPLAIN
    if follow_up_count < MAX_FOLLOW_UPS:
        return State.FOLLOW_UP
    return State.EXPLAIN  # proceed with a tentative diagnosis


def after_probe(
    *, is_correct: bool, hypothesis_accepted: bool, follow_up_count: int
) -> State:
    if is_correct:
        return State.TRANSFER  # one different-context question before believing it
    return after_wrong_answer(
        hypothesis_accepted=hypothesis_accepted, follow_up_count=follow_up_count
    )


def after_follow_up(*, hypothesis_accepted: bool, follow_up_count: int) -> State:
    """follow_up_count includes the follow-up that was just answered."""
    if hypothesis_accepted or follow_up_count >= MAX_FOLLOW_UPS:
        return State.EXPLAIN
    return State.FOLLOW_UP


def after_transfer(
    *,
    is_correct: bool,
    status: MasteryStatus,
    hypothesis_accepted: bool,
    follow_up_count: int,
) -> State:
    if is_correct:
        return State.SUMMARY if status == "demonstrated" else State.PRACTICE
    return after_wrong_answer(
        hypothesis_accepted=hypothesis_accepted, follow_up_count=follow_up_count
    )


def after_practice(
    *,
    is_correct: bool,
    status: MasteryStatus,
    cycle_count: int,
    prereq_done: bool,
) -> State:
    """cycle_count = explanation cycles already given for this concept."""
    if is_correct:
        return State.SUMMARY if status == "demonstrated" else State.PRACTICE
    if cycle_count < MAX_CYCLES:
        return State.EXPLAIN
    if not prereq_done:
        return State.PREREQ_REVIEW
    return State.SUMMARY  # flagged 'needs more help' in the summary
