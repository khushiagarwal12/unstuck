"""Concept extraction with validation (ARCHITECTURE.md sections 4 and 5.5).

The model proposes; the backend checks. A concept survives only if it has a real name, and at least
one source quote that appears word for word in the chunk it cites. Prerequisites must form a DAG.
"""

from __future__ import annotations

from typing import Sequence

from ..errors import AppError
from ..llm.client import BaseLLM
from ..llm.prompts import render
from ..llm.schemas import ConceptDraft, ConceptList
from ..retrieval.vectors import quote_supported
from .chunk import Chunk

MIN_CONCEPTS = 2
MAX_CONCEPTS = 10


def validate_concepts(drafts: Sequence[ConceptDraft], chunks: Sequence[Chunk]) -> list[dict]:
    by_id = {c.id: c for c in chunks}
    kept: list[tuple[ConceptDraft, list[dict]]] = []
    names: set[str] = set()

    for d in drafts:
        name = " ".join(d.name.split())
        key = name.casefold()
        if not name or key in names:
            continue
        refs = []
        for s in d.sources:
            chunk = by_id.get(s.chunk_id)
            if chunk and quote_supported(s.quote, chunk.text):
                refs.append({"chunk_id": chunk.id, "page": chunk.page, "quote": s.quote.strip()})
        if not refs:
            continue
        names.add(key)
        kept.append((d.model_copy(update={"name": name}), refs[:3]))

    kept = kept[:MAX_CONCEPTS]
    ids = {d.name.casefold(): f"c{i + 1}" for i, (d, _) in enumerate(kept)}

    prereqs: dict[str, list[str]] = {}
    for d, _ in kept:
        cid = ids[d.name.casefold()]
        out: list[str] = []
        for p in d.prerequisites:
            pid = ids.get(" ".join(p.split()).casefold())
            if pid and pid != cid and pid not in out and not _reaches(prereqs, pid, cid):
                out.append(pid)  # adding pid -> cid is safe: pid does not already depend on cid
        prereqs[cid] = out

    result = [
        {
            "id": ids[d.name.casefold()],
            "name": d.name,
            "description": " ".join(d.description.split()),
            "prerequisites": prereqs[ids[d.name.casefold()]],
            "sourceRefs": refs,
        }
        for d, refs in kept
    ]
    if len(result) < MIN_CONCEPTS:
        raise AppError(
            "no_concepts",
            "We couldn't find enough distinct ideas to study in that material. Try a longer or clearer section.",
            status=422,
        )
    return result


def _reaches(prereqs: dict[str, list[str]], start: str, target: str) -> bool:
    """True if `start` already depends (directly or not) on `target`."""
    stack, seen = [start], set()
    while stack:
        node = stack.pop()
        if node == target:
            return True
        if node in seen:
            continue
        seen.add(node)
        stack.extend(prereqs.get(node, []))
    return False


def render_chunks(chunks: Sequence[Chunk]) -> str:
    return "\n\n".join(f'[chunk_id: {c.id} | page {c.page}]\n{c.text}' for c in chunks)


async def extract_concepts(llm: BaseLLM, chunks: Sequence[Chunk]) -> list[dict]:
    prompt = render("concepts", chunks=render_chunks(chunks))
    drafts = await llm.generate_structured(prompt=prompt, schema=ConceptList, tier="main")
    return validate_concepts(drafts.concepts, chunks)
