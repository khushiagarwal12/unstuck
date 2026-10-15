"""Citation validation and grounding verification (ARCHITECTURE.md section 5.5).

Verifies normalize(quote) appears in the cited chunk's text.
Invalid refs are dropped. Never invent or hallucinate citations.
"""

from __future__ import annotations

import difflib
import re
from typing import Mapping

from ..schemas import SourceRef


def normalize_text(text: str) -> str:
    """Lowercase, strip punctuation, collapse whitespace."""
    lower = text.lower()
    no_punct = re.sub(r"[^\w\s]", " ", lower)
    return " ".join(no_punct.split())


def quote_in_chunk(quote: str, chunk_text: str, fuzzy_threshold: float = 0.85) -> bool:
    """Check if quote exists in chunk text either verbatim or with light fuzzy tolerance."""
    norm_quote = normalize_text(quote)
    norm_chunk = normalize_text(chunk_text)

    if not norm_quote:
        return False

    # Exact normalized substring match
    if norm_quote in norm_chunk:
        return True

    # Fuzzy sliding window match for minor OCR / spacing variations
    q_words = norm_quote.split()
    c_words = norm_chunk.split()
    q_len = len(q_words)

    if q_len == 0 or len(c_words) < q_len:
        return False

    for i in range(len(c_words) - q_len + 1):
        window = " ".join(c_words[i : i + q_len])
        ratio = difflib.SequenceMatcher(None, norm_quote, window).ratio()
        if ratio >= fuzzy_threshold:
            return True

    return False


def validate_citations(
    source_refs: list[SourceRef],
    chunks_by_id: Mapping[str, dict],
) -> list[SourceRef]:
    """Filter out any citations where the quote cannot be grounded in the referenced chunk."""
    valid: list[SourceRef] = []
    for ref in source_refs:
        chunk = chunks_by_id.get(ref.chunk_id)
        if not chunk:
            continue
        chunk_text = chunk.get("text", "")
        if quote_in_chunk(ref.quote, chunk_text):
            # Ensure correct page number from chunk
            page = chunk.get("page", ref.page)
            valid.append(SourceRef(chunk_id=ref.chunk_id, page=page, quote=ref.quote))

    return valid
