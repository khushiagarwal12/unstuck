"""Firestore persistence layer (ARCHITECTURE.md section 6).

All reads and writes go through the backend (Admin SDK in production,
in-memory simulated store in dev/test mode).
Clients never access Firestore directly.
"""

from __future__ import annotations

import datetime
import logging
from typing import Any, Mapping

from ..config import Settings, get_settings

log = logging.getLogger("unstuck.firestore")


class Database:
    """Abstract interface for database operations."""

    async def get_user(self, uid: str) -> dict[str, Any] | None: ...
    async def upsert_user(self, uid: str, data: Mapping[str, Any]) -> None: ...
    async def check_and_increment_usage(self, uid: str, field: str, limit: int, date_str: str) -> bool: ...

    async def get_document(self, doc_id: str) -> dict[str, Any] | None: ...
    async def save_document(self, doc_id: str, data: Mapping[str, Any]) -> None: ...
    async def update_document(self, doc_id: str, data: Mapping[str, Any]) -> None: ...
    async def delete_document(self, doc_id: str) -> None: ...
    async def list_documents_for_user(self, uid: str) -> list[dict[str, Any]]: ...

    async def save_chunks_blob(self, doc_id: str, chunks: list[dict[str, Any]]) -> None: ...
    async def get_chunks_blob(self, doc_id: str) -> list[dict[str, Any]] | None: ...

    async def save_vectors_blob(self, doc_id: str, vectors_bytes: bytes, ids: list[str]) -> None: ...
    async def get_vectors_blob(self, doc_id: str) -> tuple[bytes, list[str]] | None: ...

    async def save_concept(self, doc_id: str, concept: Mapping[str, Any]) -> None: ...
    async def get_concepts(self, doc_id: str) -> list[dict[str, Any]]: ...
    async def get_concept(self, doc_id: str, concept_id: str) -> dict[str, Any] | None: ...

    async def save_question(self, doc_id: str, question: Mapping[str, Any]) -> None: ...
    async def get_questions_for_concept(self, doc_id: str, concept_id: str) -> list[dict[str, Any]]: ...
    async def get_question(self, doc_id: str, qid: str) -> dict[str, Any] | None: ...

    async def save_session(self, session_id: str, data: Mapping[str, Any]) -> None: ...
    async def get_session(self, session_id: str) -> dict[str, Any] | None: ...
    async def update_session(self, session_id: str, data: Mapping[str, Any]) -> None: ...
    async def list_sessions_for_user(self, uid: str) -> list[dict[str, Any]]: ...

    async def record_attempt(self, session_id: str, attempt: Mapping[str, Any]) -> None: ...
    async def get_attempts(self, session_id: str) -> list[dict[str, Any]]: ...

    async def get_mastery(self, uid: str, concept_key: str) -> dict[str, Any] | None: ...
    async def save_mastery(self, uid: str, concept_key: str, data: Mapping[str, Any]) -> None: ...
    async def list_mastery_for_user(self, uid: str) -> list[dict[str, Any]]: ...

    async def save_course(self, course_id: str, data: Mapping[str, Any]) -> None: ...
    async def get_course(self, course_id: str) -> dict[str, Any] | None: ...
    async def update_course(self, course_id: str, data: Mapping[str, Any]) -> None: ...
    async def list_courses_for_user(self, uid: str) -> list[dict[str, Any]]: ...


class MemoryDatabase(Database):
    """In-memory Firestore emulator for local development and unit tests."""

    def __init__(self) -> None:
        self.users: dict[str, dict[str, Any]] = {}
        self.documents: dict[str, dict[str, Any]] = {}
        self.chunks: dict[str, list[dict[str, Any]]] = {}
        self.vectors: dict[str, tuple[bytes, list[str]]] = {}
        self.concepts: dict[str, dict[str, dict[str, Any]]] = {}  # doc_id -> {concept_id -> data}
        self.questions: dict[str, dict[str, dict[str, Any]]] = {}  # doc_id -> {qid -> data}
        self.sessions: dict[str, dict[str, Any]] = {}
        self.attempts: dict[str, list[dict[str, Any]]] = {}  # sid -> [attempts]
        self.mastery: dict[str, dict[str, Any]] = {}  # f"{uid}_{concept_key}" -> data
        self.courses: dict[str, dict[str, Any]] = {}

    async def get_user(self, uid: str) -> dict[str, Any] | None:
        return self.users.get(uid)

    async def upsert_user(self, uid: str, data: Mapping[str, Any]) -> None:
        current = self.users.get(uid, {})
        self.users[uid] = {**current, **dict(data)}

    async def check_and_increment_usage(self, uid: str, field: str, limit: int, date_str: str) -> bool:
        user = self.users.setdefault(uid, {
            "createdAt": datetime.datetime.now(datetime.timezone.utc).isoformat(),
            "usage": {"date": date_str, "llmCalls": 0, "uploads": 0},
        })
        usage = user.setdefault("usage", {"date": date_str, "llmCalls": 0, "uploads": 0})
        if usage.get("date") != date_str:
            usage["date"] = date_str
            usage["llmCalls"] = 0
            usage["uploads"] = 0
        current_count = usage.get(field, 0)
        if current_count >= limit:
            return False
        usage[field] = current_count + 1
        return True

    async def get_document(self, doc_id: str) -> dict[str, Any] | None:
        return self.documents.get(doc_id)

    async def save_document(self, doc_id: str, data: Mapping[str, Any]) -> None:
        self.documents[doc_id] = dict(data)

    async def update_document(self, doc_id: str, data: Mapping[str, Any]) -> None:
        if doc_id in self.documents:
            self.documents[doc_id].update(data)
        else:
            self.documents[doc_id] = dict(data)

    async def delete_document(self, doc_id: str) -> None:
        self.documents.pop(doc_id, None)
        self.chunks.pop(doc_id, None)
        self.vectors.pop(doc_id, None)
        self.concepts.pop(doc_id, None)
        self.questions.pop(doc_id, None)

    async def list_documents_for_user(self, uid: str) -> list[dict[str, Any]]:
        return [doc for doc in self.documents.values() if doc.get("userId") == uid]

    async def save_chunks_blob(self, doc_id: str, chunks: list[dict[str, Any]]) -> None:
        self.chunks[doc_id] = [dict(c) for c in chunks]

    async def get_chunks_blob(self, doc_id: str) -> list[dict[str, Any]] | None:
        return self.chunks.get(doc_id)

    async def save_vectors_blob(self, doc_id: str, vectors_bytes: bytes, ids: list[str]) -> None:
        self.vectors[doc_id] = (vectors_bytes, list(ids))

    async def get_vectors_blob(self, doc_id: str) -> tuple[bytes, list[str]] | None:
        return self.vectors.get(doc_id)

    async def save_concept(self, doc_id: str, concept: Mapping[str, Any]) -> None:
        cid = concept.get("id") or concept.get("conceptId")
        if not cid:
            raise ValueError("Concept must have id")
        doc_concepts = self.concepts.setdefault(doc_id, {})
        doc_concepts[cid] = dict(concept)

    async def get_concepts(self, doc_id: str) -> list[dict[str, Any]]:
        return list(self.concepts.get(doc_id, {}).values())

    async def get_concept(self, doc_id: str, concept_id: str) -> dict[str, Any] | None:
        return self.concepts.get(doc_id, {}).get(concept_id)

    async def save_question(self, doc_id: str, question: Mapping[str, Any]) -> None:
        qid = question.get("id")
        if not qid:
            raise ValueError("Question must have id")
        doc_q = self.questions.setdefault(doc_id, {})
        doc_q[qid] = dict(question)

    async def get_questions_for_concept(self, doc_id: str, concept_id: str) -> list[dict[str, Any]]:
        return [
            q for q in self.questions.get(doc_id, {}).values()
            if q.get("concept_id") == concept_id or q.get("createdFor") == concept_id
        ]

    async def get_question(self, doc_id: str, qid: str) -> dict[str, Any] | None:
        return self.questions.get(doc_id, {}).get(qid)

    async def save_session(self, session_id: str, data: Mapping[str, Any]) -> None:
        self.sessions[session_id] = dict(data)

    async def get_session(self, session_id: str) -> dict[str, Any] | None:
        return self.sessions.get(session_id)

    async def update_session(self, session_id: str, data: Mapping[str, Any]) -> None:
        if session_id in self.sessions:
            self.sessions[session_id].update(data)
        else:
            self.sessions[session_id] = dict(data)

    async def list_sessions_for_user(self, uid: str) -> list[dict[str, Any]]:
        return [s for s in self.sessions.values() if s.get("userId") == uid]

    async def record_attempt(self, session_id: str, attempt: Mapping[str, Any]) -> None:
        self.attempts.setdefault(session_id, []).append(dict(attempt))

    async def get_attempts(self, session_id: str) -> list[dict[str, Any]]:
        return self.attempts.get(session_id, [])

    async def get_mastery(self, uid: str, concept_key: str) -> dict[str, Any] | None:
        return self.mastery.get(f"{uid}_{concept_key}")

    async def save_mastery(self, uid: str, concept_key: str, data: Mapping[str, Any]) -> None:
        self.mastery[f"{uid}_{concept_key}"] = dict(data)

    async def list_mastery_for_user(self, uid: str) -> list[dict[str, Any]]:
        prefix = f"{uid}_"
        return [v for k, v in self.mastery.items() if k.startswith(prefix)]

    async def save_course(self, course_id: str, data: Mapping[str, Any]) -> None:
        self.courses[course_id] = dict(data)

    async def get_course(self, course_id: str) -> dict[str, Any] | None:
        return self.courses.get(course_id)

    async def update_course(self, course_id: str, data: Mapping[str, Any]) -> None:
        if course_id in self.courses:
            self.courses[course_id].update(data)
        else:
            self.courses[course_id] = dict(data)

    async def list_courses_for_user(self, uid: str) -> list[dict[str, Any]]:
        return [c for c in self.courses.values() if c.get("userId") == uid]


class FirestoreDatabase(Database):
    """Production Firestore client using firebase-admin SDK."""

    def __init__(self, client: Any) -> None:
        self._db = client

    async def get_user(self, uid: str) -> dict[str, Any] | None:
        snap = self._db.collection("users").document(uid).get()
        return snap.to_dict() if snap.exists else None

    async def upsert_user(self, uid: str, data: Mapping[str, Any]) -> None:
        self._db.collection("users").document(uid).set(dict(data), merge=True)

    async def check_and_increment_usage(self, uid: str, field: str, limit: int, date_str: str) -> bool:
        ref = self._db.collection("users").document(uid)
        snap = ref.get()
        user_data = snap.to_dict() if snap.exists else {}
        usage = user_data.get("usage", {})
        if usage.get("date") != date_str:
            usage = {"date": date_str, "llmCalls": 0, "uploads": 0}
        current_count = usage.get(field, 0)
        if current_count >= limit:
            return False
        usage[field] = current_count + 1
        ref.set({"usage": usage}, merge=True)
        return True

    async def get_document(self, doc_id: str) -> dict[str, Any] | None:
        snap = self._db.collection("documents").document(doc_id).get()
        return snap.to_dict() if snap.exists else None

    async def save_document(self, doc_id: str, data: Mapping[str, Any]) -> None:
        self._db.collection("documents").document(doc_id).set(dict(data))

    async def update_document(self, doc_id: str, data: Mapping[str, Any]) -> None:
        self._db.collection("documents").document(doc_id).set(dict(data), merge=True)

    async def delete_document(self, doc_id: str) -> None:
        self._db.collection("documents").document(doc_id).delete()

    async def list_documents_for_user(self, uid: str) -> list[dict[str, Any]]:
        docs = self._db.collection("documents").where("userId", "==", uid).stream()
        return [d.to_dict() for d in docs]

    async def save_chunks_blob(self, doc_id: str, chunks: list[dict[str, Any]]) -> None:
        self._db.collection("documents").document(doc_id).collection("blobs").document("chunks").set(
            {"chunks": chunks}
        )

    async def get_chunks_blob(self, doc_id: str) -> list[dict[str, Any]] | None:
        snap = (
            self._db.collection("documents")
            .document(doc_id)
            .collection("blobs")
            .document("chunks")
            .get()
        )
        return snap.to_dict().get("chunks") if snap.exists else None

    async def save_vectors_blob(self, doc_id: str, vectors_bytes: bytes, ids: list[str]) -> None:
        self._db.collection("documents").document(doc_id).collection("blobs").document("vectors").set(
            {"vectors": vectors_bytes, "ids": ids}
        )

    async def get_vectors_blob(self, doc_id: str) -> tuple[bytes, list[str]] | None:
        snap = (
            self._db.collection("documents")
            .document(doc_id)
            .collection("blobs")
            .document("vectors")
            .get()
        )
        if not snap.exists:
            return None
        d = snap.to_dict()
        return d.get("vectors"), d.get("ids", [])

    async def save_concept(self, doc_id: str, concept: Mapping[str, Any]) -> None:
        cid = concept.get("id") or concept.get("conceptId")
        self._db.collection("documents").document(doc_id).collection("concepts").document(cid).set(
            dict(concept)
        )

    async def get_concepts(self, doc_id: str) -> list[dict[str, Any]]:
        stream = self._db.collection("documents").document(doc_id).collection("concepts").stream()
        return [s.to_dict() for s in stream]

    async def get_concept(self, doc_id: str, concept_id: str) -> dict[str, Any] | None:
        snap = (
            self._db.collection("documents")
            .document(doc_id)
            .collection("concepts")
            .document(concept_id)
            .get()
        )
        return snap.to_dict() if snap.exists else None

    async def save_question(self, doc_id: str, question: Mapping[str, Any]) -> None:
        qid = question.get("id")
        self._db.collection("documents").document(doc_id).collection("questions").document(qid).set(
            dict(question)
        )

    async def get_questions_for_concept(self, doc_id: str, concept_id: str) -> list[dict[str, Any]]:
        stream = (
            self._db.collection("documents")
            .document(doc_id)
            .collection("questions")
            .where("createdFor", "==", concept_id)
            .stream()
        )
        return [s.to_dict() for s in stream]

    async def get_question(self, doc_id: str, qid: str) -> dict[str, Any] | None:
        snap = (
            self._db.collection("documents")
            .document(doc_id)
            .collection("questions")
            .document(qid)
            .get()
        )
        return snap.to_dict() if snap.exists else None

    async def save_session(self, session_id: str, data: Mapping[str, Any]) -> None:
        self._db.collection("sessions").document(session_id).set(dict(data))

    async def get_session(self, session_id: str) -> dict[str, Any] | None:
        snap = self._db.collection("sessions").document(session_id).get()
        return snap.to_dict() if snap.exists else None

    async def update_session(self, session_id: str, data: Mapping[str, Any]) -> None:
        self._db.collection("sessions").document(session_id).set(dict(data), merge=True)

    async def list_sessions_for_user(self, uid: str) -> list[dict[str, Any]]:
        stream = self._db.collection("sessions").where("userId", "==", uid).stream()
        return [s.to_dict() for s in stream]

    async def record_attempt(self, session_id: str, attempt: Mapping[str, Any]) -> None:
        aid = attempt.get("id") or self._db.collection("sessions").document(session_id).collection("attempts").document().id
        self._db.collection("sessions").document(session_id).collection("attempts").document(aid).set(
            dict(attempt)
        )

    async def get_attempts(self, session_id: str) -> list[dict[str, Any]]:
        stream = (
            self._db.collection("sessions")
            .document(session_id)
            .collection("attempts")
            .order_by("ts")
            .stream()
        )
        return [s.to_dict() for s in stream]

    async def get_mastery(self, uid: str, concept_key: str) -> dict[str, Any] | None:
        snap = self._db.collection("mastery").document(f"{uid}_{concept_key}").get()
        return snap.to_dict() if snap.exists else None

    async def save_mastery(self, uid: str, concept_key: str, data: Mapping[str, Any]) -> None:
        self._db.collection("mastery").document(f"{uid}_{concept_key}").set(dict(data), merge=True)

    async def list_mastery_for_user(self, uid: str) -> list[dict[str, Any]]:
        stream = self._db.collection("mastery").where("userId", "==", uid).stream()
        return [s.to_dict() for s in stream]

    async def save_course(self, course_id: str, data: Mapping[str, Any]) -> None:
        self._db.collection("courses").document(course_id).set(dict(data))

    async def get_course(self, course_id: str) -> dict[str, Any] | None:
        snap = self._db.collection("courses").document(course_id).get()
        return snap.to_dict() if snap.exists else None

    async def update_course(self, course_id: str, data: Mapping[str, Any]) -> None:
        self._db.collection("courses").document(course_id).set(dict(data), merge=True)

    async def list_courses_for_user(self, uid: str) -> list[dict[str, Any]]:
        stream = self._db.collection("courses").where("userId", "==", uid).stream()
        return [c.to_dict() for c in stream]


_memory_db_instance: MemoryDatabase | None = None


from fastapi import Depends

def get_db(settings: Settings = Depends(get_settings)) -> Database:
    """Return database client based on settings."""
    global _memory_db_instance

    if settings.firebase_service_account_json or settings.google_cloud_project:
        try:
            import json
            import firebase_admin
            from firebase_admin import credentials, firestore

            if not firebase_admin._apps:
                if settings.firebase_service_account_json:
                    cred = credentials.Certificate(json.loads(settings.firebase_service_account_json))
                    firebase_admin.initialize_app(cred)
                elif settings.google_cloud_project:
                    firebase_admin.initialize_app(options={"projectId": settings.google_cloud_project})
            return FirestoreDatabase(firestore.client())
        except Exception as exc:
            log.warning("Could not initialize real Firestore, falling back to MemoryDatabase: %s", exc)

    if _memory_db_instance is None:
        _memory_db_instance = MemoryDatabase()
    return _memory_db_instance


def reset_memory_db() -> None:
    """Helper for testing."""
    global _memory_db_instance
    _memory_db_instance = MemoryDatabase()
