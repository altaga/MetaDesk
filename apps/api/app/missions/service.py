"""Fork a prompt into parallel model turns and read the answers back.

A mission is a group of ``mission`` jobs that share a ``mission_id``. Each
thread is one independent turn that runs on the mission lane (see
``jobs.runner``), so several answers come back side by side instead of one
after another. The group itself has no table of its own: it is read back out
of the durable job history, which means a fork survives a restart exactly like
any other job, is cancellable with the ordinary job routes, and never grows the
schema.
"""

from __future__ import annotations

import json
import uuid

from .. import db
from ..config import AppError, settings
from ..jobs import runner
from ..jobs import service as jobs

#: How many mission jobs a single scan will look at when rebuilding groups.
_SCAN_LIMIT = 500


def fork(
    *,
    user_id: int,
    tasks: list[str],
    prompt: str | None = None,
    notify_session_id: int | None = None,
) -> tuple[str, list[dict]]:
    """Queue one mission thread per task and return the new mission id + rows.

    ``prompt`` is an optional shared preamble prepended to every task, so the
    operator can give the threads a common frame and let each task carry the
    angle. Threads are returned in queue order; the caller hands them to the
    mission lane.
    """

    cleaned = [str(task).strip() for task in tasks or [] if str(task).strip()]
    if not cleaned:
        raise AppError(
            "validation_error",
            "A mission needs at least one task.",
            status_code=422,
            field="tasks",
        )
    if len(cleaned) > settings.mission_max_tasks:
        raise AppError(
            "validation_error",
            f"A mission takes at most {settings.mission_max_tasks} tasks.",
            status_code=422,
            field="tasks",
        )

    preamble = (prompt or "").strip()
    mission_id = "mis_" + uuid.uuid4().hex[:12]
    threads: list[dict] = []
    for index, task in enumerate(cleaned):
        job = jobs.enqueue(
            user_id=user_id,
            kind=runner.MISSION_KIND,
            payload={
                "mission_id": mission_id,
                "index": index,
                "prompt": preamble,
                "task": task,
            },
            notify_session_id=notify_session_id,
        )
        threads.append(job)
    return mission_id, threads


def list_missions(user_id: int, *, limit: int = 5) -> list[dict]:
    """Recent missions, newest first, each with its threads in order."""

    capped = max(1, min(limit, 50))
    groups = _group_rows(_mission_rows(user_id))
    return [mission_out(mission_id, rows) for mission_id, rows in groups[:capped]]


def get_mission(user_id: int, mission_id: str) -> dict | None:
    """One mission by id, or None when the operator has no such fork."""

    rows = [row for row in _mission_rows(user_id) if _mission_id(row) == mission_id]
    if not rows:
        return None
    return mission_out(mission_id, rows)


def mission_out(mission_id: str, rows: list[dict]) -> dict:
    """Shape a mission group for the desk: its threads, in fork order."""

    ordered = sorted(rows, key=_index)
    prompt = ""
    for row in ordered:
        prompt = str(_payload(row).get("prompt") or "").strip()
        if prompt:
            break
    return {
        "mission_id": mission_id,
        "prompt": prompt,
        "created_at": ordered[0]["created_at"] if ordered else None,
        "threads": [jobs.job_out(row) for row in ordered],
    }


def _mission_rows(user_id: int) -> list[dict]:
    """Every live mission job for the operator, newest first."""

    return db.fetchall(
        "SELECT * FROM board_jobs WHERE user_id = ? AND kind = ? AND status != 'dismissed' "
        "ORDER BY created_at DESC LIMIT ?",
        (user_id, runner.MISSION_KIND, _SCAN_LIMIT),
    )


def _group_rows(rows: list[dict]) -> list[tuple[str, list[dict]]]:
    """Bucket mission jobs by mission_id, preserving newest-mission-first order."""

    groups: dict[str, list[dict]] = {}
    order: list[str] = []
    for row in rows:
        mission_id = _mission_id(row)
        if not mission_id:
            continue
        if mission_id not in groups:
            groups[mission_id] = []
            order.append(mission_id)
        groups[mission_id].append(row)
    return [(mission_id, groups[mission_id]) for mission_id in order]


def _mission_id(row: dict) -> str:
    return str(_payload(row).get("mission_id") or "")


def _index(row: dict) -> int:
    try:
        return int(_payload(row).get("index") or 0)
    except (TypeError, ValueError):
        return 0


def _payload(row: dict) -> dict:
    try:
        return json.loads(row.get("payload_json") or "{}")
    except (TypeError, json.JSONDecodeError):
        return {}
