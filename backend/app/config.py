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
    llm_backend: Literal["aistudio", "vertex", "fake"] = "aistudio"
    gemini_api_key: str = ""
    gemini_model_main: str = "gemini-3-flash-preview"
    gemini_model_fast: str = "gemini-3.1-flash-lite-preview"
    gemini_embed_model: str = ""  # confirm on Day 0
    llm_timeout_seconds: float = 25.0
    # Requests per minute per tier, from the AI Studio free-tier limits. Conservative defaults.
    llm_rpm_main: int = 5
    llm_rpm_fast: int = 10

    # Auth. 'dev' accepts 'Bearer dev-<uid>' and must never be used on a public host.
    auth_mode: Literal["firebase", "dev"] = "firebase"
    firebase_service_account_json: str = ""

    cors_origins: list[str] = Field(default_factory=lambda: ["http://localhost:5173"])

    # Abuse protection (section 10 of ARCHITECTURE.md)
    daily_uploads_per_user: int = 3
    daily_llm_calls_per_user: int = 120
    judge_code: str = ""


@lru_cache
def get_settings() -> Settings:
    return Settings()
