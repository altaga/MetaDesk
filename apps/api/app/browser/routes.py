"""Browser routes: drive the board's Chromium and read its artifacts."""

from __future__ import annotations

from fastapi import APIRouter, Depends, Query
from fastapi.responses import Response
from pydantic import BaseModel, Field

from ..auth.service import get_current_user
from ..config import AppError
from . import runtime

router = APIRouter(prefix="/v1/browser", tags=["browser"], dependencies=[Depends(get_current_user)])


class BrowserAction(BaseModel):
    """One browser action and the inputs it accepts."""

    action: str = Field(min_length=1, max_length=32)
    url: str | None = None
    selector: str | None = None
    text: str | None = Field(default=None, max_length=2000)
    headed: bool = False
    #: Live preview input (action="interact"); x/y are fractions of the viewport.
    input: str | None = Field(default=None, max_length=16)
    x: float | None = None
    y: float | None = None
    dy: float | None = None
    key: str | None = Field(default=None, max_length=32)
    width: int | None = None
    height: int | None = None


def _unavailable(exc: RuntimeError) -> AppError:
    return AppError("browser_unavailable", str(exc), status_code=503, retryable=True)


@router.get("/status")
def api_status() -> dict:
    return runtime.status_for(0)


@router.get("/artifacts")
def api_artifacts(limit: int = Query(default=40, ge=1, le=200)) -> dict:
    return {"artifacts": runtime.list_artifacts(limit=limit)}


@router.get("/artifacts/file")
def api_artifact_file(path: str = Query(...)) -> Response:
    try:
        data, media = runtime.artifact_bytes(path)
    except FileNotFoundError as exc:
        raise AppError("not_found", "That artifact does not exist.", status_code=404) from exc
    except PermissionError as exc:
        raise AppError("not_an_artifact", "That path is not a browser artifact.", status_code=400) from exc
    return Response(content=data, media_type=media)


@router.post("/action")
def api_action(body: BrowserAction) -> dict:
    params = {
        "url": body.url,
        "selector": body.selector,
        "text": body.text,
        "headed": body.headed,
        "input": body.input,
        "x": body.x,
        "y": body.y,
        "dy": body.dy,
        "key": body.key,
        "width": body.width,
        "height": body.height,
    }
    try:
        return runtime.run_action(body.action, params)
    except (RuntimeError, TimeoutError) as exc:
        raise _unavailable(RuntimeError(str(exc))) from exc


@router.post("/warm")
def api_warm() -> dict:
    """Start Chromium ahead of the first preview, so it is not a cold launch."""

    try:
        return runtime.warm_session()
    except (RuntimeError, TimeoutError) as exc:
        raise _unavailable(RuntimeError(str(exc))) from exc


@router.post("/close")
def api_close() -> dict:
    return runtime.close_session()
