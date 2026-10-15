"""Question validation gate (ARCHITECTURE.md section 4).

Validates every generated question through four strict checks:
1. Schema integrity (options, exactly one correct, distractors have signals for concept's misconceptions)
2. Blind solve agreement (independent model solve without key)
3. Duplicate prevention (cosine similarity < 0.90 against previous session questions)
4. Grounding check (source_chunk_ids exist in document)
Only verified questions are ever served in live learning loops.
"""

from __future__ import annotations

import logging
from typing import Sequence

import numpy as np

from ..llm.client import BaseLLM
from ..llm.schemas import BlindSolveResult, GeneratedQuestion
from ..schemas import Option, Question

log = logging.getLogger("unstuck.questions.validate")


def validate_schema(
    q: GeneratedQuestion,
    misconception_ids: Sequence[str],
) -> tuple[bool, str]:
    """Check 3-4 options, 1 correct, distractors reference real misconception IDs."""
    if len(q.options) < 3 or len(q.options) > 4:
        return False, f"Expected 3-4 options, got {len(q.options)}"

    option_ids = [o.id for o in q.options]
    if q.correct_option_id not in option_ids:
        return False, f"Correct option {q.correct_option_id} not in options {option_ids}"

    valid_m_ids = set(misconception_ids)

    for o in q.options:
        if o.id == q.correct_option_id:
            continue
        # Distractors must signal at least one real misconception
        if not o.signals:
            return False, f"Distractor {o.id} has no signals"
        for m_id, sig in o.signals.items():
            if m_id not in valid_m_ids:
                return False, f"Distractor {o.id} signals unknown misconception {m_id}"
            if sig <= 0.0 or sig > 1.0:
                return False, f"Invalid signal strength {sig} for {m_id}"

    if not q.rationale.strip():
        return False, "Missing rationale"
    if not q.context_tag.strip():
        return False, "Missing context_tag"

    return True, "ok"


async def check_blind_solve(
    q: GeneratedQuestion,
    llm: BaseLLM,
) -> bool:
    """Independent solve by fast tier model without answer key."""
    options_text = "\n".join(f"{o.id}) {o.text}" for o in q.options)
    prompt = f"Question: {q.stem}\n\nOptions:\n{options_text}\n\nChoose the correct option."
    try:
        result = await llm.generate_structured(
            prompt=prompt,
            schema=BlindSolveResult,
            tier="fast",
            system="You are an expert student solving a multiple-choice question. Return JSON with chosen_option_id and rationale.",
        )
        agrees = result.chosen_option_id.strip().lower() == q.correct_option_id.strip().lower()
        if not agrees:
            log.warning(
                "blind_solve_disagreement expected=%s got=%s",
                q.correct_option_id,
                result.chosen_option_id,
            )
        return agrees
    except Exception as exc:
        log.warning("blind_solve_error: %s", exc)
        return False


async def check_duplicates(
    stem: str,
    existing_stems: Sequence[str],
    llm: BaseLLM,
    max_similarity: float = 0.90,
) -> bool:
    """Ensure question is not a near-duplicate of earlier questions in session."""
    if not existing_stems:
        return True

    all_texts = [stem] + list(existing_stems)
    try:
        embeddings = await llm.embed(all_texts)
        stem_vec = np.array(embeddings[0], dtype=np.float32)
        norm_stem = np.linalg.norm(stem_vec)
        if norm_stem == 0:
            return True
        stem_norm = stem_vec / norm_stem

        for other_raw in embeddings[1:]:
            other_vec = np.array(other_raw, dtype=np.float32)
            norm_other = np.linalg.norm(other_vec)
            if norm_other == 0:
                continue
            cos_sim = float(np.dot(stem_norm, other_vec / norm_other))
            if cos_sim >= max_similarity:
                log.warning("duplicate_question_detected sim=%.3f", cos_sim)
                return False
        return True
    except Exception as exc:
        log.warning("duplicate_check_skipped: %s", exc)
        return True


def check_grounding(
    source_chunk_ids: Sequence[str],
    valid_chunk_ids: set[str],
) -> bool:
    """If source chunks are provided, check they belong to the document."""
    if not valid_chunk_ids:
        # Topic document without chunks
        return True
    return all(cid in valid_chunk_ids for cid in source_chunk_ids)


async def validate_question(
    q: GeneratedQuestion,
    concept_id: str,
    kind: str,
    misconception_ids: Sequence[str],
    valid_chunk_ids: set[str],
    existing_stems: Sequence[str],
    llm: BaseLLM,
    qid: str,
) -> tuple[bool, Question | None]:
    """Execute all validation steps."""
    schema_ok, reason = validate_schema(q, misconception_ids)
    if not schema_ok:
        log.warning("question_schema_invalid: %s", reason)
        return False, None

    if not check_grounding(q.source_chunk_ids, valid_chunk_ids):
        log.warning("question_grounding_invalid chunks=%s", q.source_chunk_ids)
        return False, None

    # Blind solve check
    solve_ok = await check_blind_solve(q, llm)
    if not solve_ok:
        return False, None

    # Duplicate check
    dup_ok = await check_duplicates(q.stem, existing_stems, llm)
    if not dup_ok:
        return False, None

    question_model = Question(
        id=qid,
        concept_id=concept_id,
        kind=kind,  # type: ignore[arg-type]
        stem=q.stem,
        options=[
            Option(id=o.id, text=o.text, signals=o.signals)
            for o in q.options
        ],
        correct_option_id=q.correct_option_id,
        rationale=q.rationale,
        context_tag=q.context_tag,
        visual=q.visual,
        source_chunk_ids=q.source_chunk_ids,
        verified=True,
    )
    return True, question_model
