"""Question generation with validation retry (ARCHITECTURE.md section 4 & 5.2).

Generates questions lazy and per concept. Runs validate_question() and
retries once on failure before raising an error.
"""

from __future__ import annotations

import logging
import uuid
from typing import Sequence

from ..errors import AppError
from ..llm.client import BaseLLM
from ..llm.schemas import GeneratedQuestion
from ..schemas import Question
from .validate import validate_question

log = logging.getLogger("unstuck.questions.generate")


def _format_misconceptions(misconceptions: Sequence[dict]) -> str:
    lines = []
    for m in misconceptions:
        mid = m.get("id", "")
        label = m.get("label", "")
        desc = m.get("description", "")
        lines.append(f"- {mid}: {label} ({desc})")
    return "\n".join(lines)


def _format_chunks(chunks: Sequence[dict]) -> str:
    lines = []
    for c in chunks:
        cid = c.get("id", "")
        text = c.get("text", "")[:300]
        lines.append(f"[{cid}] {text}...")
    return "\n".join(lines)


async def generate_and_validate_question(
    *,
    concept_id: str,
    concept_name: str,
    concept_description: str,
    misconceptions: Sequence[dict],
    source_chunks: Sequence[dict],
    kind: str,
    existing_stems: Sequence[str],
    llm: BaseLLM,
    discriminating_pair: tuple[str, str] | None = None,
    preferred_context_tag: str | None = None,
) -> Question:
    """Generate a question of specified kind and validate it. Retries once if validation fails."""
    m_ids = [m["id"] for m in misconceptions]
    valid_chunk_ids = {c["id"] for c in source_chunks}

    extra_instructions = f"Generate a {kind} question."
    if discriminating_pair:
        m1, m2 = discriminating_pair
        extra_instructions += (
            f" IMPORTANT: This is a discriminating follow-up question. "
            f"Make sure one distractor clearly targets {m1} and another clearly targets {m2} "
            f"so their answers separate these two misconceptions."
        )
    if preferred_context_tag:
        extra_instructions += f" Use a context different from: '{preferred_context_tag}'."

    prompt = (
        f"<CONTEXT>\n"
        f"Concept: {concept_name} - {concept_description}\n\n"
        f"Misconceptions:\n{_format_misconceptions(misconceptions)}\n\n"
        f"Question Kind: {kind}\n"
        f"Instructions: {extra_instructions}\n\n"
        f"Source chunks:\n{_format_chunks(source_chunks)}\n"
        f"</CONTEXT>\n\n"
        f"Generate a {kind} multiple choice question adhering strictly to the schema. "
        f"Ensure every distractor has signals for known misconceptions."
    )

    system_instruction = (
        "You are an expert diagnostic question author. Return JSON adhering to the GeneratedQuestion schema. "
        "Every wrong option must carry signals mapping misconception IDs (e.g. M1, M2) to probability weights."
    )

    last_error = ""
    for attempt in (1, 2):
        qid = f"q_{uuid.uuid4().hex[:10]}"
        try:
            raw_q = await llm.generate_structured(
                prompt=prompt if attempt == 1 else f"{prompt}\n\nPrevious attempt failed validation ({last_error}). Ensure correct option is accurate, distractors have valid signals, and rationale is clear.",
                schema=GeneratedQuestion,
                tier="main",
                system=system_instruction,
            )
        except Exception as exc:
            log.warning("generation_error attempt=%d: %s", attempt, exc)
            continue

        ok, question_model = await validate_question(
            q=raw_q,
            concept_id=concept_id,
            kind=kind,
            misconception_ids=m_ids,
            valid_chunk_ids=valid_chunk_ids,
            existing_stems=existing_stems,
            llm=llm,
            qid=qid,
        )

        if ok and question_model is not None:
            return question_model

        last_error = "blind solve or schema disagreement"
        log.warning("question_validation_failed attempt=%d", attempt)

    raise AppError(
        "question_generation_failed",
        "Could not generate a verified diagnostic question. Please try again.",
        status=502,
        retryable=True,
    )
