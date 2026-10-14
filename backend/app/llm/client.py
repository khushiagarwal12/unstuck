"""The only place that talks to a model (ARCHITECTURE.md rule 6).

BaseLLM adds rate limiting, a timeout and one validation retry around a backend-specific
`_generate_json`. Backend: GeminiLLM (AI Studio today, Vertex AI after credits).
"""

from __future__ import annotations

import asyncio
import json
import logging
from typing import Literal, Sequence, TypeVar

from pydantic import BaseModel, ValidationError

from ..config import Settings
from ..errors import AppError
from .quota import TokenBucket

log = logging.getLogger("unstuck.llm")

T = TypeVar("T", bound=BaseModel)
Tier = Literal["main", "fast"]

MAX_QUEUE_WAIT_SECONDS = 8.0


class BaseLLM:
    def __init__(self, *, timeout: float, rpm_main: int, rpm_fast: int):
        self.timeout = timeout
        self._buckets = {"main": TokenBucket(rpm_main), "fast": TokenBucket(rpm_fast)}

    # -- backend hooks -------------------------------------------------------------------
    async def _generate_json(self, *, prompt: str, system: str | None, tier: Tier, schema: type[BaseModel]) -> str:
        raise NotImplementedError

    async def _embed(self, texts: Sequence[str], query: bool) -> list[list[float]]:
        raise NotImplementedError

    # -- public API ----------------------------------------------------------------------
    async def generate_structured(
        self, *, prompt: str, schema: type[T], tier: Tier = "main", system: str | None = None
    ) -> T:
        """Return a validated `schema` instance. One retry that tells the model what was wrong."""
        attempt_prompt = prompt
        last_error = ""
        for attempt in (1, 2):
            raw = await self._call(
                lambda p=attempt_prompt: self._generate_json(prompt=p, system=system, tier=tier, schema=schema),
                tier,
            )
            try:
                return schema.model_validate_json(raw)
            except (ValidationError, json.JSONDecodeError) as exc:
                # Log the error type only: raw output can contain student or document text.
                last_error = type(exc).__name__
                log.warning("llm_invalid_output tier=%s attempt=%d error=%s", tier, attempt, last_error)
                attempt_prompt = (
                    f"{prompt}\n\nYour previous reply did not match the required JSON schema "
                    f"({last_error}). Reply again with valid JSON only."
                )
        raise AppError(
            "model_invalid_output",
            "The tutor could not produce a usable answer. Try again.",
            status=502,
            retryable=True,
        )

    async def embed(self, texts: Sequence[str], *, query: bool = False) -> list[list[float]]:
        """Embed texts. `query=True` for a search question, False for document chunks."""
        return await self._call(lambda: self._embed(texts, query), "fast")

    async def _call(self, fn, tier: Tier):
        if not await self._buckets[tier].acquire(max_wait=MAX_QUEUE_WAIT_SECONDS):
            raise AppError("busy", "The tutor is busy right now. Try again in a moment.", status=429, retryable=True)
        try:
            return await asyncio.wait_for(fn(), timeout=self.timeout)
        except asyncio.TimeoutError:
            raise AppError("model_timeout", "The tutor took too long to answer. Try again.", status=504, retryable=True)
        except AppError:
            raise
        except Exception as exc:  # provider errors: never leak details or content
            log.error("llm_provider_error type=%s", type(exc).__name__)
            raise AppError("model_unavailable", "The tutor is unavailable right now. Try again.", status=503, retryable=True)


class GeminiLLM(BaseLLM):
    """Gemini via the google-genai SDK. AI Studio today; Vertex AI is a config change later.

    NOTE: written against google-genai's documented API and checked for signature compatibility,
    but not yet exercised against the live service (needs the Day 0 API key).
    """

    def __init__(self, settings: Settings):
        super().__init__(
            timeout=settings.llm_timeout_seconds,
            rpm_main=settings.llm_rpm_main,
            rpm_fast=settings.llm_rpm_fast,
        )
        from google import genai

        if settings.llm_backend == "vertex":
            raise AppError("not_supported", "Vertex AI mode is wired in after credits arrive.", status=501)
        if not settings.gemini_api_key:
            raise AppError("llm_not_configured", "The server is missing its Gemini API key.", status=503)
        self._client = genai.Client(api_key=settings.gemini_api_key)
        self._models = {"main": settings.gemini_model_main, "fast": settings.gemini_model_fast}
        self._embed_model = settings.gemini_embed_model
        self._embed_dim = settings.gemini_embed_dim

    async def _generate_json(self, *, prompt, system, tier, schema) -> str:
        from google.genai import types

        resp = await self._client.aio.models.generate_content(
            model=self._models[tier],
            contents=prompt,
            config=types.GenerateContentConfig(
                system_instruction=system,
                response_mime_type="application/json",
                response_schema=schema,
                temperature=0.4,
            ),
        )
        return resp.text or ""

    async def _embed(self, texts, query):
        from google.genai import types

        if not self._embed_model:
            raise AppError("llm_not_configured", "No embedding model is configured.", status=503)
        out: list[list[float]] = []
        for i in range(0, len(texts), 100):  # the API caps the batch size
            resp = await self._client.aio.models.embed_content(
                model=self._embed_model,
                contents=list(texts[i : i + 100]),
                config=types.EmbedContentConfig(
                    task_type="RETRIEVAL_QUERY" if query else "RETRIEVAL_DOCUMENT",
                    output_dimensionality=self._embed_dim,
                ),
            )
            out.extend(list(e.values) for e in resp.embeddings)
        return out


def build_llm(settings: Settings) -> BaseLLM:
    return GeminiLLM(settings)
