"""Runtime configuration, read from environment variables (prefix NIVASA_) or backend/.env."""

from __future__ import annotations

from functools import lru_cache
from pathlib import Path
from typing import Literal

from pydantic import Field
from pydantic_settings import BaseSettings, SettingsConfigDict

BACKEND_DIR = Path(__file__).resolve().parents[1]


class Settings(BaseSettings):
    model_config = SettingsConfigDict(env_prefix="NIVASA_", env_file=BACKEND_DIR / ".env", extra="ignore")

    environment: Literal["development", "test", "production"] = "development"
    database_url: str = f"sqlite:///{(BACKEND_DIR / 'nivasa.db').as_posix()}"
    cors_origins: list[str] = Field(default_factory=lambda: ["http://localhost:5173", "http://127.0.0.1:5173"])

    # Demo listings are fictional and hidden by default; real listings come from OpenStreetMap and submissions.
    include_demo_listings: bool = False

    # Admin endpoints (reviewing submitted listings) are disabled unless a key is set.
    admin_api_key: str | None = None

    # Geocoding: "nominatim" (OpenStreetMap) or "none". Nominatim requires an identifying User-Agent
    # and at most one request per second: https://operations.osmfoundation.org/policies/nominatim/
    geocoder: Literal["nominatim", "none"] = "nominatim"
    nominatim_url: str = "https://nominatim.openstreetmap.org"
    nominatim_user_agent: str = "Nivasa/0.1 (student accommodation discovery; set NIVASA_NOMINATIM_USER_AGENT)"

    # Routing: "estimate" uses straight-line distance x detour factor (works offline);
    # "osrm" asks an OSRM server for road distances and falls back to the estimate on failure.
    routing_provider: Literal["estimate", "osrm"] = "estimate"
    osrm_url: str = "https://router.project-osrm.org"
    detour_factor: float = 1.3
    http_timeout_s: float = 8.0

    # Cost assumptions. Each is documented in docs/METHODOLOGY.md with its source.
    college_days_per_month: int = 24
    mess_monthly_estimate: int = 2900       # SPPU member veg meal ₹48 (Oct 2026) x 2 meals x 30 days
    metro_student_concession: float = 0.30  # Pune Metro student concession
    petrol_cost_per_km: float = 2.4         # ~₹105/litre at ~45 km/litre for a commuter scooter


@lru_cache
def get_settings() -> Settings:
    return Settings()
