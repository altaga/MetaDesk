"""Background runner for durable board jobs.

One asyncio worker drains an in-process queue; each job runs in a thread so a
long shell command never blocks the event loop that serves the API. Jobs left
queued or running after a restart are re-queued on startup.
"""

from __future__ import annotations

import asyncio
import json
import logging
from typing import Any

from ..board.metrics import board_health
from ..config import settings
from ..edge.cli import run_command
from ..vault.runtime import export_map
from . import service
from .bakeoff import run_bakeoff
from .checks import run_checks
from .probe import probe_target
from .recipes import run_deploy
from .research import run_research
from .verify import run_verify

log = logging.getLogger(__name__)

SUPPORTED_KINDS = (
    "shell",
    "verify",
    "probe",
    "health",
    "deploy",
    "checks",
    "bakeoff",
    "research",
    "record",
    "mission",
)

#: Missions are model turns, so they get their own lane and may overlap. Every
#: other kind shares the single worker so a heavy shell or deploy never races.
MISSION_KIND = "mission"

_queue: asyncio.Queue[str] | None = None
_worker: asyncio.Task | None = None
_loop_id: int | None = None

_mission_queue: asyncio.Queue[str] | None = None
_mission_workers: list[asyncio.Task] = []


async def start_worker() -> None:
    """Bind a fresh queue to this loop and re-queue unfinished jobs."""

    global _queue, _worker, _loop_id
    _queue = asyncio.Queue()
    _loop_id = id(asyncio.get_running_loop())
    if _worker and not _worker.done():
        _worker.cancel()
        try:
            await _worker
        except asyncio.CancelledError:
            pass
    _worker = asyncio.create_task(_loop(_queue), name="metadesk-job-worker")
    await _start_mission_lane()

    pending = service.list_jobs_by_status(("queued", "running"))
    for job in pending:
        if job["status"] == "running":
            service.mark_queued(job["id"])
        await _route(job)


async def stop_worker() -> None:
    global _worker, _queue, _loop_id
    await _stop_mission_lane()
    if _worker:
        _worker.cancel()
        try:
            await _worker
        except asyncio.CancelledError:
            pass
        _worker = None
    _queue = None
    _loop_id = None


async def _route(job: dict) -> None:
    """Send a job to the lane that suits it."""

    if job["kind"] == MISSION_KIND:
        await submit_mission(job["id"])
    else:
        await submit(job["id"])


async def _start_mission_lane() -> None:
    """Bring the mission lane up: several workers sharing one queue."""

    global _mission_queue, _mission_workers
    await _stop_mission_lane()
    _mission_queue = asyncio.Queue()
    width = max(1, min(int(settings.mission_concurrency), 8))
    _mission_workers = [
        asyncio.create_task(_mission_loop(_mission_queue), name=f"metadesk-mission-{index}")
        for index in range(width)
    ]


async def _stop_mission_lane() -> None:
    global _mission_queue, _mission_workers
    workers, _mission_workers = _mission_workers, []
    for task in workers:
        task.cancel()
    for task in workers:
        try:
            await task
        except asyncio.CancelledError:
            pass
    _mission_queue = None


async def submit_mission(job_id: str) -> None:
    """Queue a mission task on the mission lane so turns overlap."""

    global _mission_queue
    if _mission_queue is None or not _mission_workers:
        await _start_mission_lane()
    queue = _mission_queue
    if queue is not None:
        await queue.put(job_id)


async def _mission_loop(queue: asyncio.Queue[str]) -> None:
    """Drain the mission lane; each task is one independent model turn."""

    while True:
        job_id = await queue.get()
        try:
            await _run_mission_job(job_id)
        except Exception:  # noqa: BLE001 - one bad mission must not stop the lane
            log.exception("mission worker failed for %s", job_id)
        finally:
            queue.task_done()


def _ensure_queue() -> asyncio.Queue[str]:
    """Return the queue bound to the running loop, recreating it if needed."""

    global _queue, _loop_id
    try:
        loop_id: int | None = id(asyncio.get_running_loop())
    except RuntimeError:
        loop_id = None
    if _queue is None or _loop_id != loop_id:
        _queue = asyncio.Queue()
        _loop_id = loop_id
    return _queue


async def submit(job_id: str) -> None:
    await _ensure_queue().put(job_id)


async def _loop(queue: asyncio.Queue[str]) -> None:
    while True:
        job_id = await queue.get()
        try:
            await asyncio.to_thread(_run_job, job_id)
        except Exception:  # noqa: BLE001 - the worker must survive any job
            log.exception("job worker failed for %s", job_id)
        finally:
            queue.task_done()


def _run_job(job_id: str) -> None:
    job = service.get_job_by_id(job_id)
    if job is None or job["status"] not in ("queued", "running"):
        return
    if job["kind"] == MISSION_KIND:
        # Missions belong to their own lane; reaching here would serialise them.
        log.warning("mission job %s landed on the shared lane", job_id)
        return
    if not service.mark_running(job_id):
        return

    try:
        payload = json.loads(job["payload_json"] or "{}")
    except json.JSONDecodeError:
        payload = {}
    secrets = export_map()

    def finish(ok: bool, result: dict, error: str | None = None) -> None:
        if service.is_cancelled(job_id):
            service.mark_finished(job_id, ok=False, result=result or {}, error=error or "Cancelled by operator")
            return
        service.mark_finished(job_id, ok=ok, result=result, error=error)

    try:
        _dispatch(job_id, job["kind"], payload, secrets, finish)
    except Exception as exc:  # noqa: BLE001 - a failed job is data, not a crash
        finish(False, {}, f"{type(exc).__name__}: {exc}")


def _dispatch(job_id: str, kind: str, payload: dict, secrets: dict, finish) -> None:
    if kind == "shell":
        command = str(payload.get("command") or "").strip()
        if not command:
            raise ValueError("shell job missing command")
        row = run_command(command, secrets=secrets)
        ok = row.get("exit_code") == 0 and not row.get("timed_out")
        finish(ok, row, None if ok else (row.get("stderr") or "exit non-zero"))
    elif kind == "verify":
        result = run_verify(commands=payload.get("commands"), repeats=payload.get("repeats"), secrets=secrets)
        finish(bool(result.get("ok")), result, None if result.get("ok") else result.get("error") or "verify failed")
    elif kind == "probe":
        target = str(payload.get("target") or "").strip()
        if not target:
            raise ValueError("probe job missing target")
        result = probe_target(target)
        ok = result.get("verdict") in ("ok", "auth")
        finish(ok, result, None if ok else result.get("detail"))
    elif kind == "health":
        finish(True, board_health())
    elif kind == "deploy":
        result = run_deploy(secrets=secrets, skip_verify=bool(payload.get("skip_verify")))
        finish(bool(result.get("ok")), result, None if result.get("ok") else result.get("error") or "deploy failed")
    elif kind == "checks":
        result = run_checks(secrets=secrets)
        finish(bool(result.get("ok")), result, None if result.get("ok") else result.get("error") or "checks failed")
    elif kind == "bakeoff":
        result = run_bakeoff(repeats=int(payload.get("repeats") or 3))
        finish(bool(result.get("ok")), result, None if result.get("ok") else result.get("error"))
    elif kind == "research":
        topic = str(payload.get("topic") or "").strip()
        min_seconds = payload.get("min_seconds")
        result = run_research(
            topic=topic,
            min_seconds=float(min_seconds) if min_seconds is not None else None,
            job_id=job_id,
        )
        if result.get("cancelled"):
            finish(False, result, "Cancelled by operator")
        else:
            finish(bool(result.get("ok")), result, None if result.get("ok") else result.get("error") or "research failed")
    elif kind == "record":
        # Imported lazily: the browser runtime pulls Playwright, which is an
        # optional extra that may not be installed on every board.
        from ..browser.demo import record_demo

        result = record_demo(payload.get("body") or payload.get("plan") or "")
        if result.get("cancelled") or service.is_cancelled(job_id):
            finish(False, result, "Cancelled by operator")
        else:
            finish(bool(result.get("ok")), result, None if result.get("ok") else result.get("error") or "record failed")
    else:
        raise ValueError(f"unknown job kind {kind}")


async def _run_mission_job(job_id: str) -> None:
    """Run one mission task: a single model turn with no board tools.

    Missions are a thinking fork, not an action fork — the turn runs in the
    event loop (never a thread) so several tasks overlap, and ``allow_tools``
    is off so a mission can never touch the board behind the operator's back.
    """

    job = service.get_job_by_id(job_id)
    if job is None or job["status"] not in ("queued", "running"):
        return
    if not service.mark_running(job_id):
        return

    try:
        payload = json.loads(job["payload_json"] or "{}")
    except json.JSONDecodeError:
        payload = {}
    task_text = str(payload.get("task") or "").strip()
    if not task_text:
        service.mark_finished(job_id, ok=False, result={}, error="Mission task is empty.")
        return
    preamble = str(payload.get("prompt") or "").strip()
    prompt_text = f"{preamble}\n\n{task_text}" if preamble else task_text

    answer = ""
    meta: dict[str, Any] = {}
    try:
        # Imported lazily: the provider clients stay out of the import graph
        # until the first fork.
        from ..router import hybrid

        async for event, data in hybrid.stream_turn(text=prompt_text, tier_request="auto", allow_tools=False):
            if event == "token":
                answer += str(data.get("text") or "")
            elif event == "done":
                meta = data
    except Exception as exc:  # noqa: BLE001 - a failed mission is data, not a crash
        service.mark_finished(
            job_id,
            ok=False,
            result={"answer": answer},
            error=f"{type(exc).__name__}: {exc}",
        )
        return

    service.mark_finished(job_id, ok=True, result={"answer": answer, **meta})
