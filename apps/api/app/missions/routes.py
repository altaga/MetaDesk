"""Missions routes: fork a prompt into parallel turns and read the group back.

Creation is a fork; everything after that (cancel, dismiss, inspect) reuses the
ordinary job routes, so a mission thread behaves exactly like any other job.
"""

from __future__ import annotations

from fastapi import APIRouter, Depends
from pydantic import BaseModel, Field

from ..auth.models import User
from ..auth.service import get_current_user
from ..config import AppError
from ..jobs import runner
from .service import fork, get_mission, list_missions, mission_out

router = APIRouter(prefix="/v1/missions", tags=["missions"], dependencies=[Depends(get_current_user)])


class ForkRequest(BaseModel):
    tasks: list[str] = Field(min_length=1)
    prompt: str | None = Field(default=None, max_length=4000)
    notify_session_id: int | None = Field(default=None, ge=1)


@router.get("")
def api_list_missions(limit: int = 5, user: User = Depends(get_current_user)) -> dict:
    return {"missions": list_missions(user.id, limit=limit)}


@router.get("/threads")
def api_mission_threads(mission_id: str, user: User = Depends(get_current_user)) -> dict:
    mission = get_mission(user.id, mission_id)
    if mission is None:
        raise AppError("not_found", "Mission not found.", status_code=404)
    return mission


@router.post("/fork")
async def api_fork_mission(body: ForkRequest, user: User = Depends(get_current_user)) -> dict:
    """Queue one independent model turn per task, grouped under one mission."""

    mission_id, threads = fork(
        user_id=user.id,
        tasks=body.tasks,
        prompt=body.prompt,
        notify_session_id=body.notify_session_id,
    )
    for job in threads:
        await runner.submit_mission(job["id"])
    return mission_out(mission_id, threads)
