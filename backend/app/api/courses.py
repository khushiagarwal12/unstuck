"""Learn with AI (topic-first course mode) (ARCHITECTURE.md section 18).

Builds an ordered personalized study plan based on a short placement diagnostic.
Each module links directly to the standard learning loop.
"""

from __future__ import annotations

import datetime
import logging
import uuid
from typing import Optional

from fastapi import APIRouter, Depends
from pydantic import BaseModel

from ..auth import User, current_user
from ..config import Settings, get_settings
from ..core.mastery import derive_status
from ..errors import AppError
from ..llm.client import BaseLLM, build_llm
from ..llm.schemas import BatchedPlacementQuestions, TopicCourseScope
from ..questions.validate import validate_schema
from ..schemas import Option, Question
from ..storage.firestore import Database, get_db

log = logging.getLogger("unstuck.api.courses")
router = APIRouter(prefix="/api/courses", tags=["courses"])


def _now_iso() -> str:
    return datetime.datetime.now(datetime.timezone.utc).isoformat()


class CreateCourseRequest(BaseModel):
    topic: str
    level: Optional[str] = "beginner"
    goal: Optional[str] = None


class PlacementAnswerRequest(BaseModel):
    stepId: str
    questionId: str
    optionId: str


def _topological_sort(concepts: list[dict]) -> list[str]:
    """Sort concept IDs in prerequisite topological order."""
    prereqs: dict[str, set[str]] = {c["id"]: set(c.get("prerequisites", [])) for c in concepts}
    all_ids = set(prereqs.keys())
    ordered: list[str] = []

    while all_ids:
        # Find concepts with no unvisited prerequisites
        ready = [cid for cid in all_ids if not (prereqs[cid] & all_ids)]
        if not ready:
            # Cycle fallback: pick any
            ready = [next(iter(all_ids))]
        for cid in sorted(ready):
            ordered.append(cid)
            all_ids.remove(cid)

    return ordered


@router.post("")
async def create_course(
    req: CreateCourseRequest,
    user: User = Depends(current_user),
    db: Database = Depends(get_db),
    settings: Settings = Depends(get_settings),
):
    """Scope a topic, create a topic document, and generate placement check questions."""
    topic_clean = req.topic.strip()
    if len(topic_clean) < 3:
        raise AppError("topic_too_short", "Please provide a more specific topic.", status=400)

    course_id = f"course_{uuid.uuid4().hex[:10]}"
    doc_id = f"doc_topic_{uuid.uuid4().hex[:10]}"
    llm: Optional[BaseLLM] = None

    # 1. Scope topic concepts with prerequisites
    scope_prompt = (
        f"Topic: {topic_clean}\n"
        f"Target Level: {req.level}\n"
        f"Learning Goal: {req.goal or 'Mastery of foundational and practical concepts'}\n\n"
        f"Provide 4 to 6 foundational-to-advanced concepts with clear prerequisite dependencies (DAG)."
    )

    try:
        llm = build_llm(settings)
        scope = await llm.generate_structured(
            prompt=scope_prompt,
            schema=TopicCourseScope,
            tier="main",
            system="You are an expert curriculum designer. Return TopicCourseScope JSON with 4-6 concepts and valid prerequisites DAG.",
        )
        concepts_data = [
            {
                "id": c.id,
                "conceptId": c.id,
                "name": c.name,
                "description": c.description,
                "prerequisites": c.prerequisites,
                "sourceRefs": [],
                "catalogStatus": "pending",
                "misconceptions": [],
            }
            for c in scope.concepts
        ]
    except Exception as exc:
        log.warning("Course scoping fallback: %s", exc)
        concepts_data = [
            {"id": "c1", "conceptId": "c1", "name": f"Foundations of {topic_clean}", "description": "Core terminology and fundamentals.", "prerequisites": [], "sourceRefs": [], "catalogStatus": "pending", "misconceptions": []},
            {"id": "c2", "conceptId": "c2", "name": f"Core Principles of {topic_clean}", "description": "Key mechanisms and problem solving.", "prerequisites": ["c1"], "sourceRefs": [], "catalogStatus": "pending", "misconceptions": []},
            {"id": "c3", "conceptId": "c3", "name": f"Advanced Applications in {topic_clean}", "description": "Complex scenarios and transfer.", "prerequisites": ["c2"], "sourceRefs": [], "catalogStatus": "pending", "misconceptions": []},
        ]

    # 2. Create topic document (grounded = false)
    await db.save_document(doc_id, {
        "id": doc_id,
        "userId": user.uid,
        "fileName": f"Course: {topic_clean}",
        "contentHash": f"topic_{topic_clean}",
        "status": "ready",
        "statusDetail": "AI-guided topic course.",
        "progress": 1.0,
        "isTopic": True,
        "pageCount": 0,
        "warnings": [],
        "createdAt": _now_iso(),
        "updatedAt": _now_iso(),
    })
    for c in concepts_data:
        await db.save_concept(doc_id, c)

    # 3. Generate placement check questions
    ordered_concept_ids = _topological_sort(concepts_data)
    placement_prompt = (
        f"For the topic '{topic_clean}', generate one multiple-choice diagnostic placement question "
        f"for each of these concepts: {', '.join(ordered_concept_ids[:5])}."
    )

    placement_questions: list[Question] = []
    if llm is not None:
        try:
            batch_res = await llm.generate_structured(
                prompt=placement_prompt,
                schema=BatchedPlacementQuestions,
                tier="main",
                system="Generate a single multiple-choice diagnostic question per concept for placement.",
            )
            for idx, gq in enumerate(batch_res.questions):
                cid = ordered_concept_ids[idx] if idx < len(ordered_concept_ids) else ordered_concept_ids[0]
                qid = f"q_place_{uuid.uuid4().hex[:8]}"
                q_model = Question(
                    id=qid,
                    concept_id=cid,
                    kind="probe",
                    stem=gq.stem,
                    options=[Option(id=o.id, text=o.text, signals=o.signals) for o in gq.options],
                    correct_option_id=gq.correct_option_id,
                    rationale=gq.rationale,
                    context_tag="placement_diagnostic",
                    visual=gq.visual,
                    source_chunk_ids=[],
                    verified=True,
                )
                placement_questions.append(q_model)
                await db.save_question(doc_id, q_model.model_dump())
        except Exception as exc:
            log.warning("Placement generation fallback: %s", exc)

    # 4. Formulate initial plan (ordered topologically)
    plan = [
        {"conceptId": cid, "order": idx + 1, "type": "learn", "status": "pending"}
        for idx, cid in enumerate(ordered_concept_ids)
    ]

    course_data = {
        "id": course_id,
        "courseId": course_id,
        "userId": user.uid,
        "documentId": doc_id,
        "topic": topic_clean,
        "level": req.level,
        "goal": req.goal,
        "status": "placement" if placement_questions else "ready",
        "placement": {
            "questions": [q.model_dump() for q in placement_questions],
            "currentIndex": 0,
            "answers": {},
        },
        "plan": plan,
        "createdAt": _now_iso(),
        "updatedAt": _now_iso(),
    }
    await db.save_course(course_id, course_data)

    current_placement_q = placement_questions[0].to_public() if placement_questions else None

    return {
        "courseId": course_id,
        "documentId": doc_id,
        "topic": topic_clean,
        "status": course_data["status"],
        "plan": plan,
        "placementQuestion": current_placement_q,
    }


@router.get("/{course_id}")
async def get_course(
    course_id: str,
    user: User = Depends(current_user),
    db: Database = Depends(get_db),
):
    """Retrieve course roadmap, placement status, and modules."""
    course = await db.get_course(course_id)
    if not course or course.get("userId") != user.uid:
        raise AppError("not_found", "Course not found.", status=404)

    doc_id = course["documentId"]
    concepts = await db.get_concepts(doc_id)
    concepts_by_id = {c["id"]: c for c in concepts}

    # Enrich plan with concept names and mastery status
    enriched_plan = []
    for item in course.get("plan", []):
        cid = item["conceptId"]
        concept = concepts_by_id.get(cid, {})
        mastery = await db.get_mastery(user.uid, cid)
        mastery_status = mastery.get("status", "not_assessed") if mastery else "not_assessed"
        enriched_plan.append({
            **item,
            "name": concept.get("name", cid),
            "description": concept.get("description", ""),
            "masteryStatus": mastery_status,
        })

    placement = course.get("placement", {})
    current_idx = placement.get("currentIndex", 0)
    questions = placement.get("questions", [])
    current_q = None
    if course.get("status") == "placement" and current_idx < len(questions):
        raw_q = Question.model_validate(questions[current_idx])
        current_q = raw_q.to_public()

    return {
        "courseId": course_id,
        "documentId": doc_id,
        "topic": course.get("topic"),
        "status": course.get("status"),
        "plan": enriched_plan,
        "placementQuestion": current_q,
    }


@router.post("/{course_id}/placement/answer")
async def answer_placement(
    course_id: str,
    req: PlacementAnswerRequest,
    user: User = Depends(current_user),
    db: Database = Depends(get_db),
):
    """Submit answer for a placement question and advance to next or finalize plan."""
    course = await db.get_course(course_id)
    if not course or course.get("userId") != user.uid:
        raise AppError("not_found", "Course not found.", status=404)

    placement = course.get("placement", {})
    questions = placement.get("questions", [])
    current_idx = placement.get("currentIndex", 0)

    if current_idx >= len(questions):
        return {"status": "ready", "plan": course.get("plan")}

    current_q = Question.model_validate(questions[current_idx])
    is_correct = (req.optionId == current_q.correct_option_id)

    # Record answer
    placement.setdefault("answers", {})[current_q.concept_id] = {
        "questionId": current_q.id,
        "optionId": req.optionId,
        "isCorrect": is_correct,
    }

    # Update plan module type based on placement result:
    # If correct -> confirm module (one transfer check)
    # If wrong -> learn module (full remediation loop)
    plan = course.get("plan", [])
    for p in plan:
        if p["conceptId"] == current_q.concept_id:
            p["type"] = "confirm" if is_correct else "learn"
            if is_correct:
                # Mark as developing in user mastery
                await db.save_mastery(user.uid, current_q.concept_id, {
                    "userId": user.uid,
                    "conceptId": current_q.concept_id,
                    "status": "developing",
                    "evidenceCount": 1,
                    "lastAssessedAt": _now_iso(),
                })

    current_idx += 1
    placement["currentIndex"] = current_idx

    is_finished = current_idx >= len(questions)
    new_status = "ready" if is_finished else "placement"
    course["status"] = new_status
    course["updatedAt"] = _now_iso()

    await db.update_course(course_id, course)

    next_q = None
    if not is_finished:
        next_q = Question.model_validate(questions[current_idx]).to_public()

    return {
        "status": new_status,
        "plan": plan,
        "placementQuestion": next_q,
    }


@router.post("/{course_id}/modules/{concept_id}/start")
async def start_module_session(
    course_id: str,
    concept_id: str,
    user: User = Depends(current_user),
    db: Database = Depends(get_db),
    settings: Settings = Depends(get_settings),
):
    """Launch the learning session for a specific module in the course."""
    course = await db.get_course(course_id)
    if not course or course.get("userId") != user.uid:
        raise AppError("not_found", "Course not found.", status=404)

    from .sessions import CreateSessionRequest, create_session
    # Reuse standard session creation
    return await create_session(
        CreateSessionRequest(documentId=course["documentId"], conceptId=concept_id),
        user=user,
        db=db,
        settings=settings,
    )
