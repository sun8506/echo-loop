"""Public learner API.

This process intentionally exposes only account, progress, statistics and
feedback APIs. Media import, transcription, DeepL and Sudachi remain in the
local production service defined by main.py.
"""

from __future__ import annotations

import os

from fastapi import FastAPI
from fastapi.middleware.cors import CORSMiddleware
from fastapi.middleware.trustedhost import TrustedHostMiddleware

from learner_api import router as learner_router


def _csv_environment(name: str, fallback: str) -> list[str]:
    return [item.strip() for item in os.getenv(name, fallback).split(",") if item.strip()]


app = FastAPI(
    title="EchoLoop Learner API",
    version="1.0.0",
    docs_url=None if os.getenv("ECHOLOOP_DISABLE_API_DOCS", "1") == "1" else "/api/docs",
    redoc_url=None,
    openapi_url=None if os.getenv("ECHOLOOP_DISABLE_API_DOCS", "1") == "1" else "/api/openapi.json",
)

allowed_origins = _csv_environment("ECHOLOOP_ALLOWED_ORIGINS", "http://localhost:5173,http://127.0.0.1:5173")
allowed_hosts = _csv_environment("ECHOLOOP_ALLOWED_HOSTS", "localhost,127.0.0.1")

app.add_middleware(
    TrustedHostMiddleware,
    allowed_hosts=allowed_hosts,
)
app.add_middleware(
    CORSMiddleware,
    allow_origins=allowed_origins,
    allow_credentials=False,
    allow_methods=["GET", "POST"],
    allow_headers=["Authorization", "Content-Type"],
)
app.include_router(learner_router, prefix="/api")


@app.get("/api/health")
def health() -> dict[str, object]:
    return {"ok": True, "service": "echoloop-learner", "version": "1.0.0"}
