"""Progress and insights endpoints (ARCHITECTURE.md section 7).

Aggregates concepts with mastery status, recurring misconceptions,
and past learning sessions.
"""

from __future__ import annotations

from fastapi import APIRouter, Depends

from ..auth import User, current_user
from ..storage.firestore import Database, get_db

router = APIRouter(prefix="/api/progress", tags=["progress"])


@router.get("")
async def get_progress(
    user: User = Depends(current_user),
    db: Database = Depends(get_db),
):
    """Retrieve user's concept mastery map, recurring errors, and session history."""
    mastery_list = await db.list_mastery_for_user(user.uid)
    sessions = await db.list_sessions_for_user(user.uid)

    # Calculate recurring misconceptions from sessions
    misconception_counts: dict[str, dict] = {}
    for s in sessions:
        hyp = s.get("activeHypothesis")
        if hyp and hyp.get("misconception_id"):
            mid = hyp["misconception_id"]
            if mid not in misconception_counts:
                misconception_counts[mid] = {
                    "id": mid,
                    "label": hyp.get("label", mid),
                    "count": 0,
                }
            misconception_counts[mid]["count"] += 1

    recurring = sorted(misconception_counts.values(), key=lambda x: x["count"], reverse=True)

    # Sort sessions by recency
    recent_sessions = sorted(sessions, key=lambda s: s.get("startedAt", ""), reverse=True)[:10]

    return {
        "concepts": mastery_list,
        "recurringErrors": recurring,
        "recentSessions": [
            {
                "id": s.get("id"),
                "conceptName": s.get("conceptName"),
                "statusBefore": s.get("statusBefore"),
                "statusAfter": s.get("statusAfter"),
                "startedAt": s.get("startedAt"),
                "completedAt": s.get("completedAt"),
            }
            for s in recent_sessions
        ],
    }
