"""Fire-and-forget ops events to the cloud Worker.

Every event is also kept in a small in-process ring so the board can still show
a summary when the cloud ingest is unreachable.
"""

from __future__ import annotations

import logging
import secrets
import threading
import time
from typing import Any

import httpx

from ..cloudlink import cloud_config

log = logging.getLogger(__name__)


def new_trace_id() -> str:
    """A fresh identifier tying a turn's events together."""

    return f"req_{secrets.token_hex(10)}"


def _length_bucket(text: str) -> str:
    size = len((text or "").strip())
    if size <= 20:
        return "0-20"
    if size <= 80:
        return "21-80"
    if size <= 200:
        return "81-200"
    if size <= 500:
        return "201-500"
    return "500+"


def _guess_language(text: str) -> str:
    lowered = (text or "").lower()
    if any(char in lowered for char in "áéíóúñ¿¡") or any(
        word in lowered for word in ("hola", "gracias", "abre", "terminal", "ayuda", "ayúdame")
    ):
        return "es"
    if any(word in lowered for word in (" the ", "please", "open", "thanks", "hello", "help")):
        return "en"
    return "und"


def chat_features(input_text: str, output_text: str, extra: dict[str, Any] | None = None) -> dict[str, Any]:
    """Coarse, privacy-safe shape of a chat turn."""

    out: dict[str, Any] = {
        "msg_len": _length_bucket(input_text),
        "reply_len": _length_bucket(output_text),
        "lang": _guess_language(input_text),
        "has_run_fence": "```run" in (output_text or ""),
    }
    if extra:
        out.update(extra)
    return out


def tool_features(item: dict[str, Any]) -> dict[str, Any]:
    """Privacy-safe summary of one tool call. The cloud strips more for non-admins."""

    kind = item.get("kind")
    features: dict[str, Any] = {
        "tool_kind": kind,
        "ok": item.get("ok"),
        "exit_code": item.get("exit_code"),
        "timed_out": bool(item.get("timed_out")),
        "skipped": bool(item.get("skipped")),
        "approval": "skipped" if item.get("skipped") else "none",
    }
    if item.get("reason"):
        features["reason"] = str(item.get("reason"))[:80]
    command = item.get("command")
    if isinstance(command, str) and command.strip():
        features["command_preview"] = command.strip()[:160]
    features["stdout_len"] = _length_bucket(str(item.get("stdout") or ""))
    features["stderr_len"] = _length_bucket(str(item.get("stderr") or ""))
    return features


def emit_ops(event: dict[str, Any]) -> None:
    """Record an event locally and, when paired, ship it to the cloud.

    Never blocks the caller: the network hop happens on a daemon thread.
    """

    try:
        from .local import record_local

        record_local(event)
    except Exception:  # noqa: BLE001 - local ring is best effort
        pass

    cloud = cloud_config()
    if not cloud:
        log.info(
            "ops_local %s",
            {key: event.get(key) for key in ("kind", "status", "error_code", "route", "model", "trace_id", "phase")},
        )
        return

    def _send() -> None:
        url, token = cloud
        try:
            httpx.post(
                f"{url}/v1/ops/ingest",
                headers={"Authorization": f"Bearer {token}", "Content-Type": "application/json"},
                json=event,
                timeout=3.0,
            )
        except Exception as exc:  # noqa: BLE001 - telemetry must not break a turn
            log.warning("ops_ingest_failed: %s", type(exc).__name__)

    threading.Thread(target=_send, daemon=True).start()


def emit_tool_results(
    *,
    trace_id: str,
    session_id: str | None,
    results: list[dict[str, Any]],
) -> None:
    """One ops row per tool attempt, so a turn reads as a timeline."""

    for item in results or []:
        kind = item.get("kind") or "tool"
        skipped = bool(item.get("skipped"))
        ok = item.get("ok")
        if skipped:
            status = "skipped"
            error_code = str(item.get("reason") or "approval_required")[:80]
        elif ok is False or (item.get("exit_code") not in (None, 0) and kind == "run"):
            status = "error"
            error_code = str(item.get("error") or f"exit_{item.get('exit_code')}" or "tool_failed")[:80]
        else:
            status = "ok"
            error_code = None

        emit_ops(
            {
                "kind": "tool",
                "status": status,
                "error_code": error_code,
                "phase": "result",
                "trace_id": trace_id,
                "session_id": session_id,
                "route": str(kind)[:40],
                "path": item.get("path") or None,
                "features": tool_features(item),
                "note": f"{kind}:{status}",
            }
        )
        # A hair of spacing keeps cloud ids ordered under a burst of tools.
        time.sleep(0.01)
