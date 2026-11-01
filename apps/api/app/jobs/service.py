"""Enqueue / list / finish durable board jobs plus the desk notice feed."""

from __future__ import annotations

import json
import logging
import uuid
from datetime import datetime, timezone

from .. import db
from ..ops.emit import emit_ops

log = logging.getLogger(__name__)

_ACTIVE = ("queued", "running")
_HIDDEN = ("dismissed",)


def _now_iso() -> str:
    return datetime.now(timezone.utc).isoformat()


def enqueue(*, user_id: int, kind: str, payload: dict, notify_session_id: int | None = None) -> dict:
    """Persist a queued job and return its row."""

    job_id = str(uuid.uuid4())
    db.execute(
        "INSERT INTO board_jobs (id, user_id, kind, status, payload_json, notify_session_id, created_at) "
        "VALUES (?, ?, ?, 'queued', ?, ?, ?)",
        (job_id, user_id, kind, json.dumps(payload or {}), notify_session_id, _now_iso()),
    )
    row = get_job(user_id, job_id)
    assert row is not None  # just inserted
    return row


def get_job(user_id: int, job_id: str) -> dict | None:
    return db.fetchone("SELECT * FROM board_jobs WHERE user_id = ? AND id = ?", (user_id, job_id))


def get_job_by_id(job_id: str) -> dict | None:
    """Internal lookup without an ownership filter (used by the worker)."""

    return db.fetchone("SELECT * FROM board_jobs WHERE id = ?", (job_id,))


def list_jobs_by_status(statuses: tuple[str, ...]) -> list[dict]:
    """Every job in the given states, oldest first — used to resume on boot."""

    placeholders = ", ".join("?" for _ in statuses)
    return db.fetchall(
        f"SELECT * FROM board_jobs WHERE status IN ({placeholders}) ORDER BY created_at ASC",
        statuses,
    )


def mark_queued(job_id: str) -> None:
    """Return a job to the queue (a running job that was interrupted by a restart)."""

    db.execute("UPDATE board_jobs SET status = 'queued', started_at = NULL WHERE id = ?", (job_id,))


def list_jobs(user_id: int, *, limit: int = 40) -> list[dict]:
    capped = max(1, min(limit, 100))
    return db.fetchall(
        "SELECT * FROM board_jobs WHERE user_id = ? AND status NOT IN ('dismissed') "
        "ORDER BY created_at DESC LIMIT ?",
        (user_id, capped),
    )


def is_cancelled(job_id: str) -> bool:
    row = db.fetchone("SELECT status FROM board_jobs WHERE id = ?", (job_id,))
    return row is None or row["status"] in ("cancelled", "dismissed")


def cancel_job(user_id: int, job_id: str) -> dict | None:
    """Stop a queued/running job; a no-op status read for terminal jobs."""

    job = get_job(user_id, job_id)
    if not job or job["status"] in _HIDDEN:
        return None
    if job["status"] in _ACTIVE:
        db.execute(
            "UPDATE board_jobs SET status = 'cancelled', error = COALESCE(error, ?), finished_at = ? WHERE id = ?",
            ("Cancelled by operator", _now_iso(), job_id),
        )
    return get_job(user_id, job_id)


def dismiss_job(user_id: int, job_id: str) -> dict | None:
    """Remove from the Agents list, cancelling first when still active."""

    job = get_job(user_id, job_id)
    if not job or job["status"] in _HIDDEN:
        return None
    db.execute(
        "UPDATE board_jobs SET status = 'dismissed', "
        "error = CASE WHEN status IN ('queued', 'running') THEN COALESCE(error, 'Cancelled by operator') ELSE error END, "
        "finished_at = COALESCE(finished_at, ?) WHERE id = ?",
        (_now_iso(), job_id),
    )
    return get_job(user_id, job_id)


def mark_running(job_id: str) -> bool:
    """Move a queued job to running; honour a cancel that landed meanwhile."""

    row = db.fetchone("SELECT status FROM board_jobs WHERE id = ?", (job_id,))
    if row is None or row["status"] in ("cancelled", "dismissed"):
        return False
    db.execute("UPDATE board_jobs SET status = 'running', started_at = ? WHERE id = ?", (_now_iso(), job_id))
    return True


def mark_finished(job_id: str, *, ok: bool, result: dict, error: str | None = None) -> None:
    """Finalise a job, then raise a notice and mirror the result into chat."""

    job = db.fetchone("SELECT * FROM board_jobs WHERE id = ?", (job_id,))
    if job is None:
        return
    if job["status"] in ("cancelled", "dismissed"):
        db.execute(
            "UPDATE board_jobs SET result_json = ?, error = COALESCE(error, ?), "
            "finished_at = COALESCE(finished_at, ?) WHERE id = ?",
            (json.dumps(result or {}), (error or "")[:2000] or None, _now_iso(), job_id),
        )
        return

    db.execute(
        "UPDATE board_jobs SET status = ?, result_json = ?, error = ?, finished_at = ? WHERE id = ?",
        ("done" if ok else "error", json.dumps(result or {}), (error or "")[:2000] or None, _now_iso(), job_id),
    )
    job = db.fetchone("SELECT * FROM board_jobs WHERE id = ?", (job_id,))
    if job is None:
        return

    title = f"Job {job['kind']} {'ok' if ok else 'failed'}"
    summary = _job_chat_summary(job, ok=ok, result=result or {}, error=error)
    db.execute(
        "INSERT INTO desk_notices (user_id, job_id, kind, title, body, read, created_at) "
        "VALUES (?, ?, 'job', ?, ?, 0, ?)",
        (job["user_id"], job_id, title[:200], (error or summary)[:4000], _now_iso()),
    )
    _post_job_to_chat(job, summary)
    emit_ops(
        {
            "kind": "chat",
            "status": "ok" if ok else "error",
            "error_code": None if ok else "job_failed",
            "session_id": job["notify_session_id"],
            "features": {"job_id": job_id, "job_kind": job["kind"], "job_status": job["status"]},
            "note": title,
        }
    )


def _clean_report_excerpt(raw: str, *, max_bullets: int = 5) -> tuple[str | None, list[str]]:
    """Pull a title and a few bullets out of a report, never the whole file."""

    import re

    text = re.sub(r"<!--.*?-->", "", raw or "", flags=re.S).strip()
    text = re.sub(r"[【\[]([^】\]]{1,80})[】\]]", r"(\1)", text)
    title = None
    for line in text.splitlines():
        match = re.match(r"^#{1,3}\s+(.*\S)\s*$", line.strip())
        if match:
            title = match.group(1).strip()
            break
    bullets: list[str] = []
    for line in text.splitlines():
        match = re.match(r"^\s*[-*•]\s+(.*\S)\s*$", line)
        if not match:
            continue
        item = re.sub(r"\s+", " ", match.group(1)).strip()
        bullets.append(item[:157].rstrip() + "…" if len(item) > 160 else item)
        if len(bullets) >= max_bullets:
            break
    return title, bullets


def _job_chat_summary(job: dict, *, ok: bool, result: dict, error: str | None) -> str:
    """A short, operator-readable note about how a job ended."""

    kind = job["kind"] or "agent"
    label = {
        "research": "Research",
        "record": "Record",
        "verify": "Verify",
        "shell": "Shell",
        "deploy": "Deploy",
        "checks": "Checks",
        "bakeoff": "Bakeoff",
        "probe": "Probe",
        "health": "Health",
        "mission": "Mission",
    }.get(kind, kind.capitalize())
    if not ok:
        return f"{label} agent failed.\n\n{error or 'Unknown error'}"

    if kind == "mission":
        # A mission thread's whole point is its answer, so hand it over as-is.
        answer = str(result.get("answer") or "").strip()
        return answer or "**Mission finished** with no answer."

    if kind == "research":
        try:
            payload = json.loads(job["payload_json"] or "{}")
        except json.JSONDecodeError:
            payload = {}
        topic = result.get("topic") or payload.get("topic") or "topic"
        path = result.get("path") or ""
        sources = result.get("sources")
        angles = result.get("angles")
        lines = [f"**{label} agent finished**", "", f"Topic: {topic}"]
        meta_bits: list[str] = []
        if path:
            meta_bits.append(f"`{path}`")
        if sources is not None:
            meta_bits.append(f"{sources} sources" + (f" · {angles} angles" if angles else ""))
        if meta_bits:
            lines.append(" · ".join(meta_bits))
        if path:
            try:
                from ..edge.files import resolve_path

                title, bullets = _clean_report_excerpt(resolve_path(str(path)).read_text(encoding="utf-8"))
            except Exception:  # noqa: BLE001 - a missing report must not break the notice
                title, bullets = None, []
            if title:
                lines.extend(["", f"### {title}"])
            if bullets:
                lines.append("")
                lines.extend(f"- {bullet}" for bullet in bullets)
            lines.extend(["", f"Full report in **Files** → `{path}`."])
        return "\n".join(lines)

    path = result.get("path") or result.get("report")
    if path:
        return f"**{label} agent finished**\n\nOutput: `{path}`"
    return f"**{label} agent finished** on the board."


def _post_job_to_chat(job: dict, content: str) -> None:
    """Append the finish summary to the session that spawned the job."""

    session_id = job.get("notify_session_id")
    if not session_id:
        return
    try:
        from ..chat import service as chat_service

        if not chat_service.session_exists(int(session_id)):
            return
        chat_service.add_message(int(session_id), "assistant", content[:12000])
    except Exception:  # noqa: BLE001 — never fail the finish path over a notice
        log.exception("failed to post job result to chat session %s", session_id)


def list_notices(user_id: int, *, unread_only: bool = False, limit: int = 30) -> list[dict]:
    capped = max(1, min(limit, 100))
    if unread_only:
        return db.fetchall(
            "SELECT * FROM desk_notices WHERE user_id = ? AND read = 0 ORDER BY created_at DESC LIMIT ?",
            (user_id, capped),
        )
    return db.fetchall(
        "SELECT * FROM desk_notices WHERE user_id = ? ORDER BY created_at DESC LIMIT ?",
        (user_id, capped),
    )


def mark_notice_read(user_id: int, notice_id: int) -> dict | None:
    row = db.fetchone("SELECT * FROM desk_notices WHERE user_id = ? AND id = ?", (user_id, notice_id))
    if row is None:
        return None
    db.execute("UPDATE desk_notices SET read = 1 WHERE id = ?", (notice_id,))
    return db.fetchone("SELECT * FROM desk_notices WHERE id = ?", (notice_id,))


def job_out(job: dict) -> dict:
    return {
        "id": job["id"],
        "kind": job["kind"],
        "status": job["status"],
        "payload": _load_json(job.get("payload_json")),
        "result": _load_json(job.get("result_json")),
        "error": job.get("error"),
        "notify_session_id": job.get("notify_session_id"),
        "created_at": job.get("created_at"),
        "started_at": job.get("started_at"),
        "finished_at": job.get("finished_at"),
    }


def notice_out(row: dict) -> dict:
    return {
        "id": row["id"],
        "job_id": row["job_id"],
        "kind": row["kind"],
        "title": row["title"],
        "body": row["body"],
        "read": bool(row["read"]),
        "created_at": row["created_at"],
    }


def _load_json(raw: str | None) -> dict:
    try:
        return json.loads(raw or "{}")
    except json.JSONDecodeError:
        return {}
