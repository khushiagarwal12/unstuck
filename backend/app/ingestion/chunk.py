"""Text chunking (ARCHITECTURE.md section 5.1).

Splits extracted pages into ~800-char chunks with ~100-char overlap,
preserving page numbers and generating stable chunk IDs. Capped at 150 chunks.
"""

from __future__ import annotations

from dataclasses import asdict, dataclass
from typing import Sequence

from .extract import ExtractedPage

CHUNK_SIZE = 800
CHUNK_OVERLAP = 100
MAX_CHUNKS = 150


@dataclass
class TextChunk:
    id: str  # e.g. "c0", "c1"
    page: int  # 1-indexed page number
    text: str

    def to_dict(self) -> dict:
        return asdict(self)


def chunk_pages(pages: Sequence[ExtractedPage]) -> list[TextChunk]:
    chunks: list[TextChunk] = []
    chunk_index = 0

    for page in pages:
        text = page.text.strip()
        if not text:
            continue

        if len(text) <= CHUNK_SIZE:
            chunks.append(TextChunk(id=f"c{chunk_index}", page=page.page_number, text=text))
            chunk_index += 1
            if len(chunks) >= MAX_CHUNKS:
                break
            continue

        start = 0
        while start < len(text) and len(chunks) < MAX_CHUNKS:
            end = start + CHUNK_SIZE
            if end < len(text):
                # Try to break on sentence or newline boundary
                break_point = max(
                    text.rfind(". ", start, end),
                    text.rfind("\n", start, end),
                    text.rfind("? ", start, end),
                    text.rfind("! ", start, end),
                )
                if break_point > start + (CHUNK_SIZE // 2):
                    end = break_point + 1

            chunk_text = text[start:end].strip()
            if chunk_text:
                chunks.append(TextChunk(id=f"c{chunk_index}", page=page.page_number, text=chunk_text))
                chunk_index += 1

            if end >= len(text):
                break
            start = max(start + 1, end - CHUNK_OVERLAP)

    return chunks
