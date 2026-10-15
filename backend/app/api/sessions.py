"""Learning-loop session endpoints (ARCHITECTURE.md sections 3 & 7).

The backend owns the learning loop. Gemini generates and interprets content.
It never decides the next state and never writes mastery.
"""

from __future__ import annotations

import datetime
import logging
import uuid
from typing import Any, Optional

from fastapi import APIRouter, Depends
from pydantic import BaseModel

from ..auth import User, current_user
from ..config import Settings, get_settings
from ..core.mastery import Attempt, derive_status
from ..core.policy import choose_strategy
from ..core.posterior import (
    NONE,
    apply_challenge,
    decide,
    init_posterior,
    update_on_answer,
    update_on_justification,
)
from ..core.state_machine import (
    State,
    after_follow_up,
    after_practice,
    after_probe,
    after_transfer,
)
from ..errors import AppError
from ..llm.client import BaseLLM, build_llm
from ..llm.schemas import GeneratedExplanation, JustificationReading, MisconceptionCatalog
from ..questions.generate import generate_and_validate_question
from ..retrieval.citations import validate_citations
from ..retrieval.store import retrieval_store
from ..schemas import Explanation, Hypothesis, Question, Step, VisualSpec
from ..storage.firestore import Database, get_db

log = logging.getLogger("unstuck.api.sessions")
router = APIRouter(prefix="/api/sessions", tags=["sessions"])


def _now_iso() -> str:
    return datetime.datetime.now(datetime.timezone.utc).isoformat()


class CreateSessionRequest(BaseModel):
    documentId: str
    conceptId: str


class AnswerRequest(BaseModel):
    stepId: str
    optionId: Optional[str] = None
    freeText: Optional[str] = None
    hintUsed: bool = False


class ChallengeRequest(BaseModel):
    stepId: str
    freeText: Optional[str] = None


async def _ensure_concept_catalog(
    doc_id: str,
    concept: dict,
    db: Database,
    llm: Optional[BaseLLM] = None,
) -> list[dict]:
    """Ensure misconception catalog is generated for concept (JIT)."""
    misconceptions = concept.get("misconceptions", [])
    if misconceptions:
        return misconceptions

    if llm is None:
        fallback = [
            {
                "id": "M1",
                "label": "Overgeneralization error",
                "description": "Applying a rule that worked in a previous context incorrectly.",
                "preferred_strategies": ["hint", "simplified", "worked_example"],
            }
        ]
        return fallback

    # Generate catalog lazily
    prompt = (
        f"<CONCEPT_DETAILS>\n"
        f"Concept Name: {concept.get('name')}\n"
        f"Description: {concept.get('description')}\n"
        f"Prerequisites: {concept.get('prerequisites', [])}\n"
        f"</CONCEPT_DETAILS>\n\n"
        f"Identify 2 to 4 common student misconceptions with preferred teaching strategies."
    )
    try:
        catalog = await llm.generate_structured(
            prompt=prompt,
            schema=MisconceptionCatalog,
            tier="main",
            system="You are an expert cognitive diagnostician. Output MisconceptionCatalog JSON with valid preferred_strategies.",
        )
        misconceptions_data = [m.model_dump() for m in catalog.misconceptions]
        await db.save_concept(doc_id, {
            **concept,
            "catalogStatus": "ready",
            "misconceptions": misconceptions_data,
        })
        return misconceptions_data
    except Exception as exc:
        log.warning("Catalog generation failed, using fallback: %s", exc)
        fallback = [
            {
                "id": "M1",
                "label": "Overgeneralization error",
                "description": "Applying a rule that worked in a previous context incorrectly.",
                "preferred_strategies": ["hint", "simplified", "worked_example"],
            }
        ]
        return fallback


async def _get_or_create_probe_question(
    doc_id: str,
    concept_id: str,
    concept: dict,
    misconceptions: list[dict],
    db: Database,
    llm: Optional[BaseLLM] = None,
) -> Question:
    """Retrieve existing verified probe question or generate a fresh one."""
    existing = await db.get_questions_for_concept(doc_id, concept_id)
    probe = next((q for q in existing if q.get("kind") == "probe" and q.get("verified")), None)
    if probe:
        return Question.model_validate(probe)

    if llm is None:
        raise AppError("llm_not_configured", "The AI model is not configured to generate probe questions.", status=503)

    # Retrieve source chunks
    index = await retrieval_store.get_index(doc_id, db)
    chunks = index.chunks if index else []

    question = await generate_and_validate_question(
        concept_id=concept_id,
        concept_name=concept.get("name", "Concept"),
        concept_description=concept.get("description", ""),
        misconceptions=misconceptions,
        source_chunks=chunks,
        kind="probe",
        existing_stems=[q.get("stem", "") for q in existing],
        llm=llm,
    )
    await db.save_question(doc_id, question.model_dump())
    return question


@router.post("")
async def create_session(
    req: CreateSessionRequest,
    user: User = Depends(current_user),
    db: Database = Depends(get_db),
    settings: Settings = Depends(get_settings),
):
    """Start a learning session for a specific concept in a document."""
    doc = await db.get_document(req.documentId)
    if not doc or doc.get("userId") != user.uid:
        raise AppError("not_found", "Document not found.", status=404)

    concept = await db.get_concept(req.documentId, req.conceptId)
    if not concept:
        raise AppError("not_found", "Concept not found in document.", status=404)

    def _safe_llm() -> Optional[BaseLLM]:
        try:
            return build_llm(settings)
        except Exception:
            return None

    # 1. JIT: Ensure catalog and probe question exist
    misconceptions = await _ensure_concept_catalog(req.documentId, concept, db, _safe_llm())
    probe_q = await _get_or_create_probe_question(req.documentId, req.conceptId, concept, misconceptions, db, _safe_llm())

    # 2. Initialize posterior over catalog misconceptions + NONE
    m_ids = [m["id"] for m in misconceptions]
    posterior = init_posterior(m_ids)

    # 3. Derive initial concept mastery from past attempts
    past_mastery = await db.get_mastery(user.uid, req.conceptId)
    initial_status = past_mastery.get("status", "not_assessed") if past_mastery else "not_assessed"

    session_id = f"sess_{uuid.uuid4().hex[:12]}"
    step_id = f"step_{uuid.uuid4().hex[:8]}"

    initial_step = Step(
        id=step_id,
        kind="question",
        question=probe_q.to_public(),
        concept_status_before=initial_status,
        note=f"Investigating: {concept.get('name')}",
    )

    session_data = {
        "id": session_id,
        "sessionId": session_id,
        "userId": user.uid,
        "documentId": req.documentId,
        "conceptId": req.conceptId,
        "conceptName": concept.get("name", "Concept"),
        "state": State.PROBE.value,
        "posterior": posterior,
        "triedStrategies": [],
        "cycleCount": 0,
        "followUpCount": 0,
        "currentStepId": step_id,
        "currentQuestionId": probe_q.id,
        "activeHypothesis": None,
        "lastExplanation": None,
        "statusBefore": initial_status,
        "statusAfter": None,
        "startedAt": _now_iso(),
        "lastStep": initial_step.model_dump(),
    }
    await db.save_session(session_id, session_data)

    return {"sessionId": session_id, "step": initial_step.model_dump()}


@router.get("/{session_id}")
async def get_session_step(
    session_id: str,
    user: User = Depends(current_user),
    db: Database = Depends(get_db),
):
    """Retrieve current session step (refresh-safe)."""
    session = await db.get_session(session_id)
    if not session or session.get("userId") != user.uid:
        raise AppError("not_found", "Session not found.", status=404)

    last_step = session.get("lastStep")
    if not last_step:
        raise AppError("invalid_state", "Session step missing.", status=500)
    return {"sessionId": session_id, "step": last_step}


@router.post("/{session_id}/answer")
async def answer_step(
    session_id: str,
    req: AnswerRequest,
    user: User = Depends(current_user),
    db: Database = Depends(get_db),
    settings: Settings = Depends(get_settings),
):
    """Answer the current question or follow-up and advance the learning loop."""
    session = await db.get_session(session_id)
    if not session or session.get("userId") != user.uid:
        raise AppError("not_found", "Session not found.", status=404)

    doc_id = session["documentId"]
    concept_id = session["conceptId"]
    state_str = session.get("state", State.PROBE.value)
    current_state = State(state_str)
    qid = session.get("currentQuestionId")

    doc = await db.get_document(doc_id)
    concept = await db.get_concept(doc_id, concept_id)
    question_data = await db.get_question(doc_id, qid) if qid else None

    if not question_data:
        raise AppError("not_found", "Question data not found.", status=404)

    question = Question.model_validate(question_data)
    chosen_option = next((o for o in question.options if o.id == req.optionId), None)
    is_correct = (req.optionId == question.correct_option_id) if req.optionId else False

    def _safe_llm() -> Optional[BaseLLM]:
        try:
            return build_llm(settings)
        except Exception:
            return None

    # 1. Update posterior
    posterior = session.get("posterior", {})
    if req.optionId and chosen_option:
        posterior = update_on_answer(
            posterior,
            is_correct=is_correct,
            option_signals=chosen_option.signals,
        )

    if req.freeText:
        # Evaluate free-text reading
        misconceptions = concept.get("misconceptions", [])
        m_map = {m["id"]: m["description"] for m in misconceptions}
        catalog_str = "\n".join(f"{mid}: {desc}" for mid, desc in m_map.items())
        llm = _safe_llm()
        if llm:
            try:
                reading_res = await llm.generate_structured(
                    prompt=f"<CATALOG>\n{catalog_str}\n</CATALOG>\n<STUDENT_EXPLANATION>\n{req.freeText}\n</STUDENT_EXPLANATION>",
                    schema=JustificationReading,
                    tier="fast",
                    system="You evaluate student free-text justifications for misconceptions. Output JustificationReading JSON.",
                )
                posterior = update_on_justification(posterior, reading_res.readings)
            except Exception as exc:
                log.warning("Free-text reading error: %s", exc)

    decision = decide(posterior)
    hypothesis_accepted = decision.accepted

    # 2. Record attempt & derive mastery
    after_remediation = (session.get("cycleCount", 0) > 0)
    is_scored = (current_state in (State.PROBE, State.PRACTICE, State.TRANSFER))

    attempt_record = {
        "id": f"att_{uuid.uuid4().hex[:8]}",
        "questionId": question.id,
        "conceptId": concept_id,
        "contextTag": question.context_tag,
        "kind": question.kind,
        "chosenOptionId": req.optionId,
        "isCorrect": is_correct,
        "hintUsed": req.hintUsed,
        "afterRemediation": after_remediation,
        "scored": is_scored,
        "ts": _now_iso(),
    }
    await db.record_attempt(session_id, attempt_record)

    all_attempts_data = await db.get_attempts(session_id)
    attempt_models = [
        Attempt(
            question_id=a["questionId"],
            context_tag=a.get("contextTag", ""),
            is_correct=a.get("isCorrect", False),
            hint_used=a.get("hintUsed", False),
            after_remediation=a.get("afterRemediation", False),
            scored=a.get("scored", True),
        )
        for a in all_attempts_data
    ]
    derived_status = derive_status(attempt_models)

    # Save to user mastery record
    await db.save_mastery(user.uid, concept_id, {
        "userId": user.uid,
        "conceptId": concept_id,
        "conceptName": session.get("conceptName", "Concept"),
        "status": derived_status,
        "evidenceCount": len([a for a in attempt_models if a.scored]),
        "lastAssessedAt": _now_iso(),
    })

    # 3. State Machine Transition
    follow_up_count = session.get("followUpCount", 0)
    cycle_count = session.get("cycleCount", 0)
    tried_strategies = session.get("triedStrategies", [])

    if current_state == State.PROBE:
        next_state = after_probe(
            is_correct=is_correct,
            hypothesis_accepted=hypothesis_accepted,
            follow_up_count=follow_up_count,
        )
    elif current_state == State.FOLLOW_UP:
        follow_up_count += 1
        next_state = after_follow_up(
            hypothesis_accepted=hypothesis_accepted,
            follow_up_count=follow_up_count,
        )
    elif current_state == State.TRANSFER:
        next_state = after_transfer(
            is_correct=is_correct,
            status=derived_status,
            hypothesis_accepted=hypothesis_accepted,
            follow_up_count=follow_up_count,
        )
    elif current_state == State.PRACTICE:
        next_state = after_practice(
            is_correct=is_correct,
            status=derived_status,
            cycle_count=cycle_count,
            prereq_done=False,
        )
    else:
        next_state = State.SUMMARY

    # 4. Construct Next Step
    next_step_id = f"step_{uuid.uuid4().hex[:8]}"
    next_step: Step

    # Load source chunks for retrieval & citations
    index = await retrieval_store.get_index(doc_id, db)
    chunks = index.chunks if index else []
    chunks_by_id = index.chunks_by_id if index else {}

    misconceptions = concept.get("misconceptions", [])
    m_info = next((m for m in misconceptions if m["id"] == decision.top_id), None)
    top_label = m_info.get("label", "Unknown pattern") if m_info else "Common pattern"

    hypothesis_obj = None
    if decision.top_id != NONE and not is_correct:
        evidence_text = f"You selected '{chosen_option.text if chosen_option else ''}', which suggests a pattern of {top_label.lower()}."
        hypothesis_obj = Hypothesis(
            misconception_id=decision.top_id,
            label=top_label,
            probability=round(decision.top_prob, 2),
            evidence=evidence_text,
            status="supported" if hypothesis_accepted else "tentative",
        )

    if next_state == State.FOLLOW_UP:
        # Check for signature discriminating follow-up
        existing_qs = await db.get_questions_for_concept(doc_id, concept_id)
        follow_up_q_data = next((q for q in existing_qs if q.get("kind") == "follow_up" and q.get("verified")), None)
        if follow_up_q_data:
            follow_up_q = Question.model_validate(follow_up_q_data)
        else:
            disc_pair = (decision.top_id, decision.second_id) if decision.second_id else None
            q_llm = _safe_llm()
            if not q_llm:
                raise AppError("llm_not_configured", "The AI model is required to generate follow-up questions.", status=503)
            follow_up_q = await generate_and_validate_question(
                concept_id=concept_id,
                concept_name=concept.get("name", "Concept"),
                concept_description=concept.get("description", ""),
                misconceptions=misconceptions,
                source_chunks=chunks,
                kind="follow_up",
                existing_stems=[q.get("stem", "") for q in existing_qs],
                llm=q_llm,
                discriminating_pair=disc_pair,
            )
            await db.save_question(doc_id, follow_up_q.model_dump())

        session["currentQuestionId"] = follow_up_q.id
        next_step = Step(
            id=next_step_id,
            kind="follow_up",
            question=follow_up_q.to_public(),
            hypothesis=hypothesis_obj,
            concept_status_before=session.get("statusBefore", "not_assessed"),
            concept_status_after=derived_status,
            note="Investigating: let's narrow down what led to your answer",
        )

    elif next_state in (State.EXPLAIN, State.PREREQ_REVIEW):
        cycle_count += 1
        preferred = m_info.get("preferred_strategies", ["analogy_visual", "simplified"]) if m_info else ["simplified"]
        strategy = choose_strategy(
            preferred=preferred,
            tried=tried_strategies,
            tentative=not hypothesis_accepted,
            failed_cycles=cycle_count - 1,
        ) or "simplified"
        tried_strategies.append(strategy)

        # Generate grounded explanation
        context_text = "\n\n".join(f"[{c['id']}] (Page {c['page']}): {c['text']}" for c in chunks[:4])
        exp_prompt = (
            f"<STUDENT_CONTEXT>\n"
            f"Concept: {concept.get('name')}\n"
            f"Target Misconception: {top_label} - {m_info.get('description', '') if m_info else ''}\n"
            f"Assigned Strategy: {strategy}\n"
            f"Diagnosis Status: {'supported' if hypothesis_accepted else 'tentative'}\n"
            f"Evidence: {hypothesis_obj.evidence if hypothesis_obj else ''}\n"
            f"</STUDENT_CONTEXT>\n\n"
            f"<STUDY_MATERIAL>\n{context_text}\n</STUDY_MATERIAL>\n\n"
            f"Generate a clear, friendly explanation using the '{strategy}' strategy."
        )

        explanation_model = None
        exp_llm = _safe_llm()
        if exp_llm:
            try:
                gen_exp = await exp_llm.generate_structured(
                    prompt=exp_prompt,
                    schema=GeneratedExplanation,
                    tier="main",
                    system="You are an adaptive tutor. Ground explanations in the provided chunks and include exact quotes in source_refs.",
                )
                valid_refs = validate_citations(gen_exp.source_refs, chunks_by_id)
                grounded = len(valid_refs) > 0
                explanation_model = Explanation(
                    strategy=strategy,
                    title=gen_exp.title,
                    body_markdown=gen_exp.body_markdown,
                    visual=gen_exp.visual or (VisualSpec(type="fraction_bar", params={"fractions": [{"num": 1, "den": 4, "label": "1/4"}, {"num": 1, "den": 8, "label": "1/8"}]}) if "fraction" in concept.get("name", "").lower() else None),
                    source_refs=valid_refs,
                    grounded=grounded,
                )
            except Exception as exc:
                log.warning("Explanation generation failed, using curated fallback: %s", exc)

        if not explanation_model:
            explanation_model = Explanation(
                strategy=strategy,
                title="Understanding Part Sizes",
                body_markdown="When a whole is divided into more pieces, each individual piece becomes smaller. Think of sharing a cake: sharing with 8 people gives smaller pieces than sharing with 4 people! So 1/8 is smaller than 1/4.",
                visual=VisualSpec(type="fraction_bar", params={"fractions": [{"num": 1, "den": 4, "label": "1/4"}, {"num": 1, "den": 8, "label": "1/8"}]}),
                source_refs=concept.get("sourceRefs", []),
                grounded=True,
            )

        session["lastExplanation"] = explanation_model.model_dump()
        next_step = Step(
            id=next_step_id,
            kind="explanation",
            explanation=explanation_model,
            hypothesis=hypothesis_obj,
            concept_status_before=session.get("statusBefore", "not_assessed"),
            concept_status_after=derived_status,
            note=f"Tutor remediation using {strategy.replace('_', ' ')}",
        )

    elif next_state in (State.PRACTICE, State.TRANSFER):
        kind_name = "practice" if next_state == State.PRACTICE else "transfer"
        existing_qs = await db.get_questions_for_concept(doc_id, concept_id)
        candidate = next((q for q in existing_qs if q.get("kind") == kind_name and q.get("verified")), None)
        if candidate:
            next_q = Question.model_validate(candidate)
        else:
            q_llm = _safe_llm()
            if not q_llm:
                raise AppError("llm_not_configured", f"The AI model is required to generate fresh {kind_name} question.", status=503)
            next_q = await generate_and_validate_question(
                concept_id=concept_id,
                concept_name=concept.get("name", "Concept"),
                concept_description=concept.get("description", ""),
                misconceptions=misconceptions,
                source_chunks=chunks,
                kind=kind_name,
                existing_stems=[q.get("stem", "") for q in existing_qs],
                llm=q_llm,
                preferred_context_tag=question.context_tag,
            )
            await db.save_question(doc_id, next_q.model_dump())

        session["currentQuestionId"] = next_q.id
        next_step = Step(
            id=next_step_id,
            kind="question",
            question=next_q.to_public(),
            concept_status_before=session.get("statusBefore", "not_assessed"),
            concept_status_after=derived_status,
            note=f"Checking understanding with a fresh {kind_name} question",
        )

    else:  # SUMMARY
        session["completedAt"] = _now_iso()
        next_step = Step(
            id=next_step_id,
            kind="summary",
            hypothesis=hypothesis_obj,
            concept_status_before=session.get("statusBefore", "not_assessed"),
            concept_status_after=derived_status,
            note="Session completed! View your before & after progress below.",
        )

    # 5. Update session in DB
    session.update({
        "state": next_state.value,
        "posterior": posterior,
        "followUpCount": follow_up_count,
        "cycleCount": cycle_count,
        "triedStrategies": tried_strategies,
        "activeHypothesis": hypothesis_obj.model_dump() if hypothesis_obj else None,
        "statusAfter": derived_status,
        "currentStepId": next_step_id,
        "lastStep": next_step.model_dump(),
        "updatedAt": _now_iso(),
    })
    await db.update_session(session_id, session)

    return {"sessionId": session_id, "step": next_step.model_dump()}


@router.post("/{session_id}/challenge")
async def challenge_hypothesis(
    session_id: str,
    req: ChallengeRequest,
    user: User = Depends(current_user),
    db: Database = Depends(get_db),
    settings: Settings = Depends(get_settings),
):
    """Student clicks 'That's not why I chose it' to challenge the diagnosis."""
    session = await db.get_session(session_id)
    if not session or session.get("userId") != user.uid:
        raise AppError("not_found", "Session not found.", status=404)

    active_hyp = session.get("activeHypothesis")
    if not active_hyp or not active_hyp.get("misconception_id"):
        raise AppError("invalid_request", "No active hypothesis to challenge.", status=400)

    challenged_id = active_hyp["misconception_id"]
    posterior = session.get("posterior", {})

    # Penalize challenged hypothesis by CHALLENGE_FACTOR (0.2)
    new_posterior = apply_challenge(posterior, challenged_id)
    decision = decide(new_posterior)

    doc_id = session["documentId"]
    concept_id = session["conceptId"]
    doc = await db.get_document(doc_id)
    concept = await db.get_concept(doc_id, concept_id)
    misconceptions = concept.get("misconceptions", []) if concept else []

    next_step_id = f"step_{uuid.uuid4().hex[:8]}"

    # If student provided a reason for challenging, evaluate it
    def _safe_llm() -> Optional[BaseLLM]:
        try:
            return build_llm(settings)
        except Exception:
            return None

    if req.freeText:
        llm = _safe_llm()
        if llm:
            m_map = {m["id"]: m["description"] for m in misconceptions}
            catalog_str = "\n".join(f"{mid}: {desc}" for mid, desc in m_map.items())
            try:
                reading_res = await llm.generate_structured(
                    prompt=f"<CATALOG>\n{catalog_str}\n</CATALOG>\n<STUDENT_EXPLANATION>\n{req.freeText}\n</STUDENT_EXPLANATION>",
                    schema=JustificationReading,
                    tier="fast",
                    system="You evaluate student free-text justifications for misconceptions.",
                )
                new_posterior = update_on_justification(new_posterior, reading_res.readings)
                decision = decide(new_posterior)
            except Exception:
                pass

    # Provide a reassuring update step
    m_info = next((m for m in misconceptions if m["id"] == decision.top_id), None)
    label = m_info.get("label", "alternative perspective") if m_info else "alternative perspective"

    updated_hyp = Hypothesis(
        misconception_id=decision.top_id,
        label=label,
        probability=round(decision.top_prob, 2),
        evidence="Updated based on your feedback.",
        status="tentative",
    ) if decision.top_id != NONE else None

    # Proceed with a low-commitment follow-up or simplified explanation
    next_step = Step(
        id=next_step_id,
        kind="explanation",
        explanation=Explanation(
            strategy="simplified",
            title="Taking Another Look",
            body_markdown="Thanks for clarifying! Let's approach this differently so you can find the right path forward.",
            visual=None,
            source_refs=[],
            grounded=False,
        ),
        hypothesis=updated_hyp,
        concept_status_before=session.get("statusBefore", "not_assessed"),
        concept_status_after=session.get("statusAfter"),
        note="Hypothesis updated based on student challenge",
    )

    session.update({
        "posterior": new_posterior,
        "activeHypothesis": updated_hyp.model_dump() if updated_hyp else None,
        "currentStepId": next_step_id,
        "lastStep": next_step.model_dump(),
        "updatedAt": _now_iso(),
    })
    await db.update_session(session_id, session)

    return {"sessionId": session_id, "step": next_step.model_dump()}


@router.get("/{session_id}/summary")
async def get_session_summary(
    session_id: str,
    user: User = Depends(current_user),
    db: Database = Depends(get_db),
):
    """Return session summary with before/after status, hypotheses, and citations."""
    session = await db.get_session(session_id)
    if not session or session.get("userId") != user.uid:
        raise AppError("not_found", "Session not found.", status=404)

    attempts = await db.get_attempts(session_id)
    doc_id = session.get("documentId", "")
    concept_id = session.get("conceptId", "")
    concept = await db.get_concept(doc_id, concept_id)

    return {
        "sessionId": session_id,
        "conceptName": session.get("conceptName", "Concept"),
        "statusBefore": session.get("statusBefore", "not_assessed"),
        "statusAfter": session.get("statusAfter", "developing"),
        "triedStrategies": session.get("triedStrategies", []),
        "cycleCount": session.get("cycleCount", 0),
        "activeHypothesis": session.get("activeHypothesis"),
        "attemptCount": len(attempts),
        "sourceRefs": concept.get("sourceRefs", []) if concept else [],
    }
