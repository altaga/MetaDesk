"""Desk tools executed on the board after a model turn.

The model requests an action with a fenced block tagged ``run``, ``read``,
``list``, ``patch``, ``search`` or ``job``. Shell, read and list run inside the
desk root sandbox; patch only proposes a file change, which waits for the
operator's approval (see ``approvals``); search reaches the web through the cloud
gateway (or the board's own key); job enqueues a durable background agent that
outlives the turn.
"""

from __future__ import annotations

import re
import subprocess
from typing import Any

from ..config import AppError, desk_root_abs, resolve_under_root
from . import approvals, guardrails

LIST_CAP_BYTES = 256 * 1024
READ_CAP_BYTES = 256 * 1024
RUN_CAP_BYTES = 64 * 1024
RUN_TIMEOUT_SECONDS = 30
SEARCH_RESULT_CAP = 5

_FENCE = re.compile(r"```(run|read|list|patch|search|job)[ \t]*\r?\n(.*?)```", re.DOTALL)
#: A patch body: the file, then one SEARCH/REPLACE block.
_PATCH = re.compile(
    r"^(?:path:\s*)?(?P<path>[^\n]+?)\s*\n<{3,}\s*SEARCH[^\n]*\n(?P<old>.*?)\n?={3,}[^\n]*\n(?P<new>.*?)\n?>{3,}\s*REPLACE",
    re.DOTALL | re.IGNORECASE,
)

#: The operator phrasing that should trigger a web search even without a fence.
_WANTS_WEB = re.compile(
    r"(?i)\btavily\b|\bweb\s+search\b|\bsearch\s+(?:the\s+)?(?:web|internet|online)\b|"
    r"\b(?:busca\w*|investiga\w*|googlea\w*)\b[^\n]{0,30}?\b(?:en\s+)?(?:la\s+)?(?:web|internet|google|l[ií]nea)\b"
)
_WEB_LEAD = re.compile(
    r"(?i)^\s*(?:por\s+favor[, ]+)?(?:busca\w*|investiga\w*|googlea\w*|search)\s+(?:en\s+)?(?:la\s+|the\s+)?"
    r"(?:web|internet|google)?\s*(?:con\s+tavily|with\s+tavily)?\s*(?:y\s+|and\s+)?"
)


def _decode(raw: bytes) -> str:
    return raw.decode("utf-8", errors="replace")


def _run_list(argument: str) -> dict[str, Any]:
    try:
        target = resolve_under_root(argument)
    except AppError as exc:
        return {"name": "list", "status": "error", "reason": exc.code, "path": argument}
    if not target.is_dir():
        return {"name": "list", "status": "error", "reason": "not_a_directory", "path": argument}

    entries = []
    for child in sorted(target.iterdir(), key=lambda path: path.name.lower()):
        is_dir = child.is_dir()
        entries.append(
            {
                "name": child.name,
                "type": "dir" if is_dir else "file",
                "size": 0 if is_dir else child.stat().st_size,
            }
        )
    return {"name": "list", "status": "ok", "path": argument, "entries": entries}


def _run_read(argument: str) -> dict[str, Any]:
    try:
        target = resolve_under_root(argument)
    except AppError as exc:
        return {"name": "read", "status": "error", "reason": exc.code, "path": argument}
    if not target.is_file():
        return {"name": "read", "status": "error", "reason": "not_a_file", "path": argument}

    size = target.stat().st_size
    with target.open("rb") as handle:
        raw = handle.read(READ_CAP_BYTES)
    return {
        "name": "read",
        "status": "ok",
        "path": argument,
        "content": _decode(raw),
        "truncated": size > READ_CAP_BYTES,
    }


def _run_shell(command: str) -> dict[str, Any]:
    hw_violation = guardrails.hardware_safety_violation(command)
    if hw_violation:
        return {
            "name": "run",
            "status": "blocked",
            "reason": hw_violation,
            "command": command,
        }
    if guardrails.is_destructive(command):
        return {
            "name": "run",
            "status": "blocked",
            "reason": "approval_required",
            "command": command,
        }
    try:
        completed = subprocess.run(  # noqa: S602 - intentional operator-facing shell tool
            command,
            shell=True,
            cwd=str(desk_root_abs()),
            capture_output=True,
            timeout=RUN_TIMEOUT_SECONDS,
        )
    except subprocess.TimeoutExpired:
        return {"name": "run", "status": "error", "reason": "timeout", "command": command}

    combined = completed.stdout + completed.stderr
    return {
        "name": "run",
        "status": "ok",
        "command": command,
        "exit_code": completed.returncode,
        "output": _decode(combined[:RUN_CAP_BYTES]),
        "truncated": len(combined) > RUN_CAP_BYTES,
    }


def _propose_patch(body: str) -> dict[str, Any]:
    """Park a SEARCH/REPLACE edit for approval; nothing is written here."""

    match = _PATCH.search(body)
    if not match:
        return {"name": "patch", "status": "error", "reason": "bad_patch_format"}
    path = match.group("path").strip().strip("`\"'")
    return approvals.propose(path, match.group("old"), match.group("new"))


def execute(kind: str, argument: str) -> dict[str, Any]:
    """Execute one sandbox tool request (``list``, ``read``, ``run`` or ``patch``)."""

    if kind == "list":
        return _run_list(argument)
    if kind == "read":
        return _run_read(argument)
    if kind == "run":
        return _run_shell(argument)
    if kind == "patch":
        return _propose_patch(argument)
    return {"name": kind, "status": "error", "reason": "unknown_tool"}


def wants_web_search(user_text: str) -> bool:
    """True when the operator clearly asked for a web search."""

    return bool(_WANTS_WEB.search(user_text or ""))


def web_query_from(user_text: str) -> str:
    """Strip the 'search the web for' lead so the provider gets the topic."""

    text = " ".join((user_text or "").split())
    query = _WEB_LEAD.sub("", text).strip(" .?¿!¡") or text
    return query[:300]


async def run_search(query: str) -> dict[str, Any]:
    """Run a web search and shape the outcome as a tool event."""

    from ..tools.credits import SearchCapReached
    from ..tools.tavily import web_search

    cleaned = (query or "").strip()
    if not cleaned:
        return {"name": "search", "status": "error", "reason": "empty_query"}
    try:
        data = await web_search(cleaned, max_results=SEARCH_RESULT_CAP)
    except SearchCapReached:
        return {"name": "search", "status": "blocked", "reason": "credit_cap", "query": cleaned}

    results = [
        {
            "title": str(item.get("title") or ""),
            "url": str(item.get("url") or ""),
            "content": str(item.get("content") or "")[:400],
        }
        for item in (data.get("results") or [])[:SEARCH_RESULT_CAP]
    ]
    event: dict[str, Any] = {"name": "search", "status": "ok", "query": cleaned, "results": results}
    if data.get("dummy"):
        event["dummy"] = True
    if data.get("error"):
        event["reason"] = str(data["error"])[:200]
    return event


def parse_kv(body: str) -> dict[str, str]:
    """Parse a ```job``` fence body of ``key: value`` lines into a dict."""

    found: dict[str, str] = {}
    for line in (body or "").splitlines():
        if ":" not in line:
            continue
        key, _, value = line.partition(":")
        clean = key.strip().lower()
        if clean:
            found[clean] = value.strip()
    return found


def _default_user_id() -> int | None:
    """The board's operator id — chat itself is not user-scoped."""

    from .. import db

    row = db.fetchone("SELECT id FROM users ORDER BY id ASC LIMIT 1")
    return int(row["id"]) if row else None


def _job_payload(job_kind: str, kv: dict[str, str], raw: str = "") -> dict[str, Any]:
    """Build the payload a job kind expects from the fence key/values."""

    if job_kind == "shell":
        return {"command": kv.get("command") or ""}
    if job_kind in ("verify", "bakeoff"):
        repeats = kv.get("repeats", "")
        return {"repeats": int(repeats)} if repeats.isdigit() else {}
    if job_kind == "probe":
        return {"target": kv.get("target") or ""}
    if job_kind == "research":
        payload: dict[str, Any] = {"topic": (kv.get("topic") or kv.get("query") or "").strip()}
        seconds = kv.get("min_seconds", "").replace(".", "", 1)
        if seconds.isdigit():
            payload["min_seconds"] = float(kv["min_seconds"])
        return payload
    if job_kind == "record":
        # A recording needs url/size/format plus a multi-line step script, so the
        # whole fence body is handed to the demo parser rather than key/values.
        # The headline fields are mirrored onto the payload so the Agents list
        # can show what a recording targets.
        payload: dict[str, Any] = {"body": raw}
        for key in ("url", "format", "name"):
            if kv.get(key):
                payload[key] = kv[key]
        return payload
    return {}


async def run_job(
    body: str,
    *,
    session_id: int | None = None,
    user_id: int | None = None,
) -> dict[str, Any]:
    """Enqueue a durable background job from a ```job``` fence."""

    from ..jobs import runner
    from ..jobs.service import enqueue, job_out

    kv = parse_kv(body)
    job_kind = (kv.get("kind") or "").strip().lower()
    if job_kind not in runner.SUPPORTED_KINDS:
        return {
            "name": "job",
            "status": "error",
            "reason": "unknown_job_kind",
            "detail": f"kind must be one of: {'|'.join(runner.SUPPORTED_KINDS)}",
        }

    owner = user_id if user_id is not None else _default_user_id()
    if owner is None:
        return {"name": "job", "status": "error", "reason": "no_operator"}

    job = enqueue(
        user_id=owner,
        kind=job_kind,
        payload=_job_payload(job_kind, kv, body),
        notify_session_id=session_id,
    )
    await runner.submit(job["id"])
    return {"name": "job", "status": "ok", "job": job_out(job)}


def fenced_calls(text: str) -> list[tuple[str, str]]:
    """Every fenced tool block in ``text`` as ``(kind, argument)`` pairs."""

    return [(match.group(1), match.group(2).strip()) for match in _FENCE.finditer(text or "")]
