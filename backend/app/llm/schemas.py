"""Pydantic schemas for LLM structured outputs (ARCHITECTURE.md section 7 & 8).

Every LLM generation passes through one of these schemas.
"""

from __future__ import annotations

from typing import Literal, Optional

from pydantic import BaseModel, Field

from ..schemas import SourceRef, Strategy, VisualSpec


class SourceQuote(BaseModel):
    chunk_id: str
    quote: str


class ConceptDraft(BaseModel):
    name: str
    description: str = ""
    prerequisites: list[str] = Field(default_factory=list)
    sources: list[SourceQuote] = Field(default_factory=list)


class ConceptItem(BaseModel):
    id: str = ""
    name: str
    description: str = ""
    prerequisites: list[str] = Field(default_factory=list)
    source_refs: list[SourceRef] = Field(default_factory=list)
    sources: list[SourceQuote] = Field(default_factory=list)


class ConceptList(BaseModel):
    concepts: list[ConceptItem | ConceptDraft] = Field(min_length=1)


class MisconceptionItem(BaseModel):
    id: str
    label: str
    description: str
    preferred_strategies: list[Strategy] = Field(default_factory=list)


class MisconceptionCatalog(BaseModel):
    misconceptions: list[MisconceptionItem] = Field(min_length=1)


class GeneratedOption(BaseModel):
    id: str  # "a", "b", "c", "d"
    text: str
    signals: dict[str, float] = Field(default_factory=dict)


class GeneratedQuestion(BaseModel):
    stem: str
    options: list[GeneratedOption] = Field(min_length=3, max_length=4)
    correct_option_id: str
    rationale: str
    context_tag: str
    visual: Optional[VisualSpec] = None
    source_chunk_ids: list[str] = Field(default_factory=list)


class BlindSolveResult(BaseModel):
    chosen_option_id: str
    rationale: str


class JustificationReading(BaseModel):
    readings: dict[str, Literal["supports", "contradicts", "unclear"]]
    rationale: str


class GeneratedExplanation(BaseModel):
    title: str
    body_markdown: str
    visual: Optional[VisualSpec] = None
    source_refs: list[SourceRef] = Field(default_factory=list)


class TopicCourseScope(BaseModel):
    """Scope generated for Learn with AI topic intake."""
    topic: str
    summary: str
    concepts: list[ConceptItem] = Field(min_length=3, max_length=8)


class BatchedPlacementQuestions(BaseModel):
    questions: list[GeneratedQuestion] = Field(min_length=1, max_length=8)
