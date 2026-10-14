"""Shapes the model must return (ARCHITECTURE.md section 7.1). One per prompt file."""

from __future__ import annotations

from pydantic import BaseModel, Field


class SourceQuote(BaseModel):
    chunk_id: str
    quote: str = Field(max_length=300)


class ConceptDraft(BaseModel):
    name: str = Field(max_length=80)
    description: str = Field(max_length=400)
    prerequisites: list[str] = Field(default_factory=list)
    sources: list[SourceQuote] = Field(default_factory=list)


class ConceptList(BaseModel):
    concepts: list[ConceptDraft] = Field(max_length=15)
