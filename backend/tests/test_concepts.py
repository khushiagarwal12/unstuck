import asyncio

import pytest

from app.errors import AppError
from app.ingestion.chunk import Chunk
from app.ingestion.concepts import extract_concepts, validate_concepts
from app.llm.schemas import ConceptDraft, ConceptList, SourceQuote
from tests.fakes import ScriptedLLM

CHUNKS = [
    Chunk("p1-c0", 1, "The denominator tells us how many equal parts the whole is cut into."),
    Chunk("p2-c0", 2, "Equivalent fractions name the same amount using different numbers."),
    Chunk("p3-c0", 3, "To compare fractions, rewrite them with a common denominator first."),
]


def d(name, chunk, quote, prereqs=()):
    return ConceptDraft(name=name, description="x", prerequisites=list(prereqs),
                        sources=[SourceQuote(chunk_id=chunk, quote=quote)])


GOOD = [
    d("Parts of a fraction", "p1-c0", "how many equal parts the whole is cut into"),
    d("Equivalent fractions", "p2-c0", "name the same amount using different numbers", ["Parts of a fraction"]),
    d("Comparing fractions", "p3-c0", "rewrite them with a common denominator", ["Equivalent fractions"]),
]


def test_valid_concepts_get_ids_pages_and_prereqs():
    out = validate_concepts(GOOD, CHUNKS)
    assert [c["id"] for c in out] == ["c1", "c2", "c3"]
    assert out[1]["prerequisites"] == ["c1"] and out[2]["prerequisites"] == ["c2"]
    assert out[2]["sourceRefs"][0]["page"] == 3


def test_invented_quote_or_chunk_drops_concept():
    bad = [d("Made up", "p1-c0", "fractions are always decimals"), d("Ghost", "p9-c9", "anything goes here")]
    with pytest.raises(AppError) as e:
        validate_concepts(GOOD[:1] + bad, CHUNKS)
    assert e.value.code == "no_concepts"


def test_duplicates_dropped_and_unknown_or_self_prereqs_removed():
    drafts = [GOOD[0].model_copy(update={"prerequisites": ["Parts of a fraction", "Nope"]}),
              GOOD[0].model_copy(update={"name": "parts of a FRACTION"}), GOOD[1]]
    out = validate_concepts(drafts, CHUNKS)
    assert len(out) == 2 and out[0]["prerequisites"] == []


def test_cycles_are_broken():
    a = GOOD[0].model_copy(update={"prerequisites": ["Equivalent fractions"]})
    b = GOOD[1].model_copy(update={"prerequisites": ["Parts of a fraction"]})
    out = validate_concepts([a, b], CHUNKS)
    edges = sum(len(c["prerequisites"]) for c in out)
    assert edges == 1


def test_extract_calls_model_with_delimited_untrusted_text():
    llm = ScriptedLLM().queue(ConceptList(concepts=GOOD))
    out = asyncio.run(extract_concepts(llm, CHUNKS))
    assert len(out) == 3
    prompt = llm.calls[0]["prompt"]
    assert "<document_chunks>" in prompt and "p2-c0" in prompt and llm.calls[0]["tier"] == "main"
