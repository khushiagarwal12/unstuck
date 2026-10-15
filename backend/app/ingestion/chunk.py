"""Split page text into overlapping chunks that remember their page (ARCHITECTURE.md section 5.1)."""

from __future__ import annotations

from dataclasses import asdict, dataclass
from typing import Sequence

from ..errors import AppError
from .extract import Page

CHUNK_CHARS = 800
CHUNK_SIZE = CHUNK_CHARS
OVERLAP_CHARS = 100
CHUNK_OVERLAP = OVERLAP_CHARS
MIN_CHUNK_CHARS = 40
MAX_CHUNKS = 150  # keeps the vectors document under Firestore's 1 MiB limit


@dataclass(frozen=True)
class Chunk:
    id: str
    page: int
    text: str

    def to_dict(self) -> dict:
        return asdict(self)


TextChunk = Chunk


def _split(text: str, size: int, overlap: int) -> list[str]:
    text = text.strip()
    if len(text) <= size:
        return [text] if text else []

    pieces: list[str] = []
    start = 0
    while start < len(text):
        end = min(start + size, len(text))
        if end < len(text):
            floor = start + int(size * 0.6)
            cut = max(text.rfind(". ", floor, end), text.rfind("\n", floor, end))
            if cut == -1:
                cut = text.rfind(" ", floor, end)
            if cut != -1:
                end = cut + 1
        piece = text[start:end].strip()
        if piece:
            pieces.append(piece)
        if end >= len(text):
            break
        back = max(end - overlap, start + 1)
        space = text.find(" ", back, end)
        start = space + 1 if space != -1 else end
        if start <= back - 1:
            start = end
    return pieces


def chunk_pages(pages: Sequence[Page]) -> list[Chunk]:
    chunks: list[Chunk] = []
    for page in pages:
        pieces = _split(page.text, CHUNK_CHARS, OVERLAP_CHARS)
        kept = [p for p in pieces if len(p) >= MIN_CHUNK_CHARS] or pieces
        for i, piece in enumerate(kept):
            chunks.append(Chunk(id=f"p{page.number}-c{i}", page=page.number, text=piece))
    if len(chunks) > MAX_CHUNKS:
        raise AppError(
            "too_much_text",
            "There's too much text in that document to process at once. Upload a shorter section.",
            status=413,
        )
    return chunks
