from __future__ import annotations

import logging

from fastapi import FastAPI
from fastapi.middleware.cors import CORSMiddleware
from fastapi.middleware.gzip import GZipMiddleware

from app.api import router
from app.config import get_settings


def create_app() -> FastAPI:
    settings = get_settings()
    logging.basicConfig(level=logging.INFO)
    app = FastAPI(
        title="Nivasa API",
        version="0.1.0",
        description="Student-first hostel and PG discovery for Pune.",
        docs_url="/api/docs",
        openapi_url="/api/openapi.json",
    )
    app.add_middleware(CORSMiddleware, allow_origins=settings.cors_origins, allow_methods=["GET", "POST"],
                       allow_headers=["Content-Type", "X-Admin-Key"])
    # A search over every stay in the region is about a megabyte of JSON; compressed it is a fraction of that.
    app.add_middleware(GZipMiddleware, minimum_size=1000)
    app.include_router(router)
    return app


app = create_app()
