"""Original, committed sample material. Safe to publish."""

from __future__ import annotations

from pathlib import Path

from ..ingestion.extract import Page, clean_text

FRACTIONS_TITLE = "Fractions: Study Notes (sample)"


def fractions_pages() -> list[Page]:
    raw = (Path(__file__).parent / "fractions_notes.txt").read_text(encoding="utf-8")
    return [Page(i + 1, clean_text(t)) for i, t in enumerate(raw.split("\n---page---\n"))]
