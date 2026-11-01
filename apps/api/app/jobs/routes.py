"""Jobs routes: enqueue, inspect, cancel and dismiss durable board jobs."""

from __future__ import annotations

from fastapi import APIRouter, Depends
from pydantic import BaseModel, Field

from ..auth.models import User
from ..auth.service import get_current_user
from ..config import AppError
from . import runner
from .service import (
    cancel_job,
    dismiss_job,
    enqueue,
    get_job,
    job_out,
    list_jobs,
    list_notices,
    mark_notice_read,
    notice_out,
)

router = APIRouter(prefix="/v1/jobs", tags=["jobs"], dependencies=[Depends(get_current_user)])

_KIND_PATTERN = "^(" + "|".join(runner.SUPPORTED_KINDS) + ")$"


class EnqueueRequest(BaseModel):
    kind: str = Field(pattern=_KIND_PATTERN)
    payload: dict = Field(default_factory=dict)
    notify_session_id: int | None = Field(default=None, ge=1)


@router.get("")
def api_list_jobs(limit: int = 40, user: User = Depends(get_current_user)) -> dict:
    return {"jobs": [job_out(job) for job in list_jobs(user.id, limit=limit)]}


@router.get("/notices")
def api_list_notices(unread: bool = False, limit: int = 30, user: User = Depends(get_current_user)) -> dict:
    rows = list_notices(user.id, unread_only=unread, limit=limit)
    return {"notices": [notice_out(row) for row in rows], "unread": sum(1 for row in rows if not row["read"])}


@router.post("/notices/{notice_id}/read")
def api_read_notice(notice_id: int, user: User = Depends(get_current_user)) -> dict:
    row = mark_notice_read(user.id, notice_id)
    if row is None:
        raise AppError("not_found", "Notice not found.", status_code=404)
    return notice_out(row)


@router.get("/{job_id}")
def api_get_job(job_id: str, user: User = Depends(get_current_user)) -> dict:
    job = get_job(user.id, job_id)
    if job is None or job["status"] == "dismissed":
        raise AppError("not_found", "Job not found.", status_code=404)
    return job_out(job)


@router.post("/{job_id}/cancel")
def api_cancel_job(job_id: str, user: User = Depends(get_current_user)) -> dict:
    job = cancel_job(user.id, job_id)
    if job is None:
        raise AppError("not_found", "Job not found.", status_code=404)
    return job_out(job)


@router.delete("/{job_id}")
def api_dismiss_job(job_id: str, user: User = Depends(get_current_user)) -> dict:
    """Stop the job if it is still running, then hide it from the Agents list."""

    job = dismiss_job(user.id, job_id)
    if job is None:
        raise AppError("not_found", "Job not found.", status_code=404)
    return {"ok": True, "id": job_id, "status": "dismissed"}


@router.post("")
async def api_enqueue(body: EnqueueRequest, user: User = Depends(get_current_user)) -> dict:
    """Queue a durable job and hand it to the background worker."""

    job = enqueue(
        user_id=user.id,
        kind=body.kind,
        payload=body.payload,
        notify_session_id=body.notify_session_id,
    )
    await runner.submit(job["id"])
    return job_out(job)
