from __future__ import annotations

import os
import tempfile
from collections.abc import Iterator
from pathlib import Path

import pytest

# Configure the app for tests before anything imports app.config.
_TMP = Path(tempfile.mkdtemp(prefix="nivasa-test-"))
os.environ["NIVASA_DATABASE_URL"] = f"sqlite:///{(_TMP / 'test.db').as_posix()}"
os.environ["NIVASA_ENVIRONMENT"] = "test"
os.environ["NIVASA_GEOCODER"] = "none"
os.environ["NIVASA_ROUTING_PROVIDER"] = "estimate"
os.environ["NIVASA_INCLUDE_DEMO_LISTINGS"] = "true"  # tests rely on the demo listings' full facts
os.environ.pop("NIVASA_ADMIN_API_KEY", None)

from fastapi.testclient import TestClient  # noqa: E402

from app.config import get_settings  # noqa: E402
from app.db import Base, SessionLocal, engine  # noqa: E402
from app.main import create_app  # noqa: E402
from app.seed import seed_all  # noqa: E402
from app.services.context import reset_context  # noqa: E402


@pytest.fixture(scope="session", autouse=True)
def database() -> Iterator[None]:
    Base.metadata.create_all(engine)
    with SessionLocal() as db:
        seed_all(db, include_demo=True)
    reset_context()
    yield
    engine.dispose()


@pytest.fixture
def client() -> Iterator[TestClient]:
    get_settings.cache_clear()
    with TestClient(create_app()) as c:
        yield c
    get_settings.cache_clear()


@pytest.fixture
def db():
    with SessionLocal() as session:
        yield session


def prefs(**over) -> dict:
    base = {"destination": {"college_id": "coep"}, "budget": 14000, "gender": "boys",
            "modes": ["walk", "metro", "bus"], "max_commute_min": 30, "cuisines": ["Maharashtrian"]}
    base.update(over)
    return base
