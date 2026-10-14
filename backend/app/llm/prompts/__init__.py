"""Prompt templates live as files next to this module; `render` fills {{name}} slots."""

from __future__ import annotations

from functools import lru_cache
from pathlib import Path

_DIR = Path(__file__).parent


@lru_cache
def _read(name: str) -> str:
    return (_DIR / f"{name}.md").read_text(encoding="utf-8")


def render(name: str, **values: str) -> str:
    text = _read(name)
    for key, value in values.items():
        text = text.replace("{{" + key + "}}", value)
    return text
