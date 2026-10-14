"""API schemas (ARCHITECTURE.md section 7.1). Mirrored in frontend/src/api/types.ts.

Server-only data (answer keys, option signals) lives in Question and must never be sent to the client.
Clients receive QuestionPublic.
"""

from __future__ import annotations

from typing import Literal, Optional

from pydantic import BaseModel, Field

from .core.mastery import MasteryStatus
from .core.policy import Strategy

__all__ = [
    "Strategy", "MasteryStatus", "SourceRef", "VisualSpec", "Option", "Question",
    "QuestionPublic", "Hypothesis", "Explanation", "Step", "HealthResponse",
]


class SourceRef(BaseModel):
    chunk_id: str
    page: int
    quote: str = Field(max_length=300)


class VisualSpec(BaseModel):
    """Drawn by frontend components from these numbers, never by the model."""

    type: Literal["fraction_bar", "number_line", "area_model", "none"]
    params: dict = Field(default_factory=dict)


class Option(BaseModel):
    id: str
    text: str
    signals: dict[str, float] = Field(default_factory=dict)  # server-only


class Question(BaseModel):  # server-only
    id: str
    concept_id: str
    kind: Literal["probe", "follow_up", "practice", "transfer"]
    stem: str
    options: list[Option] = Field(min_length=3, max_length=4)
    correct_option_id: str
    rationale: str
    context_tag: str
    visual: Optional[VisualSpec] = None
    source_chunk_ids: list[str] = Field(default_factory=list)
    verified: bool = False

    def to_public(self) -> "QuestionPublic":
        return QuestionPublic(
            id=self.id,
            stem=self.stem,
            options=[{"id": o.id, "text": o.text} for o in self.options],
            visual=self.visual,
        )


class QuestionPublic(BaseModel):
    id: str
    stem: str
    options: list[dict[str, str]]
    visual: Optional[VisualSpec] = None


class Hypothesis(BaseModel):
    misconception_id: str
    label: str
    probability: float  # posterior, not model self-report
    evidence: str
    status: Literal["tentative", "supported"]


class Explanation(BaseModel):
    strategy: Strategy
    title: str
    body_markdown: str
    visual: Optional[VisualSpec] = None
    source_refs: list[SourceRef] = Field(default_factory=list)
    grounded: bool


class Step(BaseModel):
    id: str
    kind: Literal["question", "follow_up", "explanation", "summary", "error"]
    question: Optional[QuestionPublic] = None
    explanation: Optional[Explanation] = None
    hypothesis: Optional[Hypothesis] = None
    concept_status_before: MasteryStatus
    concept_status_after: Optional[MasteryStatus] = None
    note: Optional[str] = None


class HealthResponse(BaseModel):
    ok: bool
    version: str
