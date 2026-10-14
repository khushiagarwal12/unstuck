"""Settings, read from environment variables. No secrets are committed (see ../.env.example)."""

from __future__ import annotations

from functools import lru_cache
from typing import Literal

from pydantic import Field
from pydantic_settings import BaseSettings, SettingsConfigDict


class Settings(BaseSettings):
    model_config = SettingsConfigDict(env_file=".env", extra="ignore")

    app_version: str = "0.1.0"

    # AI. Model ids are confirmed on Day 0 from the AI Studio rate-limit page.
    llm_backend: Literal["aistudio", "vertex"] = "aistudio"
    gemini_api_key: str = ""
    gemini_model_main: str = "gemini-3-flash-preview"
    gemini_model_fast: str = "gemini-3.1-flash-lite-preview"
    gemini_embed_model: str = ""  # confirm on Day 0
    llm_timeout_seconds: float = 25.0
    # Requests per minute per tier, from the AI Studio free-tier limits. Conservative defaults.
    llm_rpm_main: int = 5
    llm_rpm_fast: int = 10

    # Auth: Firebase ID tokens only.
    firebase_service_account_json: str = ""

    # Enables /api/diagnostics/roundtrip, the Day 1 end-to-end check. Keep off on a public host.
    enable_diagnostics: bool = False

    cors_origins: list[str] = Field(default_factory=lambda: ["http://localhost:5173"])

    # Abuse protection (section 10 of ARCHITECTURE.md)
    daily_uploads_per_user: int = 3
    daily_llm_calls_per_user: int = 120
    daily_llm_calls_global: int = 800
    judge_code: str = ""
    judge_cap_multiplier: int = 5


@lru_cache
def get_settings() -> Settings:
    return Settings()
