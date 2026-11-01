"""MetaDesk board API application entrypoint.

Run locally with::

    uvicorn app.main:app --host 127.0.0.1 --port 8000
"""

from __future__ import annotations

import asyncio
import os
import secrets
from contextlib import asynccontextmanager
from pathlib import Path

from fastapi import FastAPI, Request
from fastapi.exceptions import RequestValidationError
from fastapi.middleware.cors import CORSMiddleware
from fastapi.responses import JSONResponse
from starlette.exceptions import HTTPException as StarletteHTTPException

from . import db
from .auth import routes as auth_routes
from .auth import service as auth_service
from .board import routes as board_routes
from .brains import routes as brains_routes
from .browser import routes as browser_routes
from .chat import routes as chat_routes
from .config import APP_NAME, APP_VERSION, AppError, desk_root_abs, settings
from .edge import routes as edge_routes
from .jobs import routes as jobs_routes
from .jobs import runner as jobs_runner
from .memory import routes as memory_routes
from .missions import routes as missions_routes
from .ops import routes as ops_routes
from .router import local_llm
from .tools import routes as tools_routes
from .vault import routes as vault_routes

_REQUEST_ID_HEADER = "X-Request-Id"

_STATUS_CODES = {
    400: "bad_request",
    401: "unauthorized",
    403: "forbidden",
    404: "not_found",
    405: "method_not_allowed",
    409: "conflict",
    422: "validation_error",
    429: "rate_limited",
}


def new_request_id() -> str:
    """Generate a fresh request identifier."""

    return "req_" + secrets.token_hex(8)


def _request_id(request: Request) -> str:
    return getattr(request.state, "request_id", None) or new_request_id()


def error_payload(
    request: Request,
    code: str,
    message: str,
    *,
    field: str | None = None,
    retryable: bool = False,
    lane: str = "control",
) -> dict:
    """Build the shared error envelope."""

    return {
        "ok": False,
        "error": {
            "code": code,
            "message": message,
            "field": field,
            "retryable": retryable,
        },
        "meta": {"request_id": _request_id(request), "lane": lane},
    }


def _error_response(
    request: Request,
    status_code: int,
    code: str,
    message: str,
    *,
    field: str | None = None,
    retryable: bool = False,
) -> JSONResponse:
    response = JSONResponse(
        status_code=status_code,
        content=error_payload(request, code, message, field=field, retryable=retryable),
    )
    response.headers[_REQUEST_ID_HEADER] = _request_id(request)
    return response


def ensure_directories() -> None:
    """Create the data and workspace directories if they are missing."""

    data_dir = os.path.dirname(db.database_path())
    if data_dir:
        Path(data_dir).mkdir(parents=True, exist_ok=True)
    desk_root_abs().mkdir(parents=True, exist_ok=True)


@asynccontextmanager
async def lifespan(app: FastAPI):
    """Prepare storage, the bootstrap operator and the job worker on startup."""

    ensure_directories()
    db.init_db()
    auth_service.ensure_bootstrap_user()
    await jobs_runner.start_worker()
    # Pin the local model in the background so the first turn never pays a
    # cold load. Startup does not wait for it.
    warm = None
    if settings.llm_mode != "cloud_only":
        warm = asyncio.create_task(local_llm.warm(settings.ollama_model))
    try:
        yield
    finally:
        if warm is not None and not warm.done():
            warm.cancel()
        await jobs_runner.stop_worker()


app = FastAPI(title=APP_NAME, version=APP_VERSION, lifespan=lifespan)

app.add_middleware(
    CORSMiddleware,
    allow_origins=settings.cors_origin_list,
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)


@app.middleware("http")
async def request_id_middleware(request: Request, call_next):
    """Attach a request identifier to every response."""

    inbound = request.headers.get(_REQUEST_ID_HEADER)
    request.state.request_id = inbound or new_request_id()
    response = await call_next(request)
    response.headers[_REQUEST_ID_HEADER] = request.state.request_id
    return response


@app.exception_handler(AppError)
async def app_error_handler(request: Request, exc: AppError) -> JSONResponse:
    return _error_response(
        request,
        exc.status_code,
        exc.code,
        exc.message,
        field=exc.field,
        retryable=exc.retryable,
    )


@app.exception_handler(RequestValidationError)
async def validation_error_handler(request: Request, exc: RequestValidationError) -> JSONResponse:
    errors = exc.errors()
    field = None
    if errors:
        location = errors[0].get("loc") or ()
        parts = [str(part) for part in location if part not in ("body", "query", "path")]
        field = ".".join(parts) or None
    return _error_response(request, 422, "validation_error", "The request payload is invalid.", field=field)


@app.exception_handler(StarletteHTTPException)
async def http_error_handler(request: Request, exc: StarletteHTTPException) -> JSONResponse:
    code = _STATUS_CODES.get(exc.status_code, "http_error")
    message = exc.detail if isinstance(exc.detail, str) else "Request failed."
    return _error_response(request, exc.status_code, code, message)


@app.exception_handler(Exception)
async def unhandled_error_handler(request: Request, exc: Exception) -> JSONResponse:
    return _error_response(
        request,
        500,
        "internal_error",
        "The board hit an unexpected error.",
        retryable=True,
    )


@app.get("/health", tags=["system"])
def health() -> dict:
    """Unauthenticated liveness probe for the board."""

    return {
        "ok": True,
        "name": APP_NAME,
        "version": APP_VERSION,
        "mode": settings.llm_mode,
        "tier": settings.compute_tier,
    }


app.include_router(auth_routes.router)
app.include_router(board_routes.router)
app.include_router(brains_routes.router)
app.include_router(browser_routes.router)
app.include_router(chat_routes.router)
app.include_router(edge_routes.router)
app.include_router(jobs_routes.router)
app.include_router(memory_routes.router)
app.include_router(missions_routes.router)
app.include_router(ops_routes.router)
app.include_router(tools_routes.router)
app.include_router(vault_routes.router)
