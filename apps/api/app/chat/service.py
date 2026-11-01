"""Chat session persistence and the streaming turn orchestration."""

from __future__ import annotations

import json
import re
from datetime import datetime, timezone
from typing import Any, AsyncIterator

from .. import db
from ..brains import service as brains_service
from ..config import AppError
from ..memory import service as memory_service
from ..router import hybrid

DEFAULT_TITLE = "New session"
TITLE_MAX = 60
#: Closes a reply the operator stopped, so the transcript shows it was cut short.
STOPPED_MARK = "(stopped)"


def _now_iso() -> str:
    return datetime.now(timezone.utc).isoformat()


_SESSION_SELECT = (
    "SELECT s.id, s.title, s.created_at, s.pinned, s.position, "
    "COALESCE(s.updated_at, s.created_at) AS updated_at, "
    "(SELECT COUNT(*) FROM chat_messages m WHERE m.session_id = s.id) AS message_count "
    "FROM chat_sessions s"
)


def _session(row: dict[str, Any]) -> dict[str, Any]:
    return {**row, "pinned": bool(row["pinned"])}


def create_session(title: str | None) -> dict[str, Any]:
    """Create a session at the top of the manual order and return its row."""

    clean_title = (title or "").strip() or DEFAULT_TITLE
    created_at = _now_iso()
    session_id, _ = db.execute(
        "INSERT INTO chat_sessions (title, created_at, updated_at, position) "
        "VALUES (?, ?, ?, (SELECT COALESCE(MIN(position), 0) - 1 FROM chat_sessions))",
        (clean_title, created_at, created_at),
    )
    return require_session(int(session_id or 0))


def list_sessions() -> list[dict[str, Any]]:
    """Return every session: pinned first, then in the operator's manual order."""

    rows = db.fetchall(f"{_SESSION_SELECT} ORDER BY s.pinned DESC, s.position ASC, s.id DESC")
    return [_session(row) for row in rows]


def session_exists(session_id: int) -> bool:
    row = db.fetchone("SELECT 1 AS present FROM chat_sessions WHERE id = ?", (session_id,))
    return row is not None


def require_session(session_id: int) -> dict[str, Any]:
    row = db.fetchone(f"{_SESSION_SELECT} WHERE s.id = ?", (session_id,))
    if row is None:
        raise AppError("not_found", "Session not found.", status_code=404, field="session_id")
    return _session(row)


def list_messages(session_id: int) -> list[dict[str, Any]]:
    """Return the messages of a session in chronological order."""

    require_session(session_id)
    return db.fetchall(
        "SELECT id, session_id, role, content, created_at, tier, model, tokens_in, tokens_out, cost_usd "
        "FROM chat_messages WHERE session_id = ? ORDER BY id ASC",
        (session_id,),
    )


def update_session(session_id: int, *, title: str | None = None, pinned: bool | None = None) -> dict[str, Any]:
    """Rename and/or pin a session; fields left as None are untouched."""

    require_session(session_id)
    if title is not None:
        clean_title = " ".join(title.split())
        if not clean_title:
            raise AppError("validation_error", "The title cannot be empty.", status_code=422, field="title")
        db.execute("UPDATE chat_sessions SET title = ? WHERE id = ?", (clean_title, session_id))
    if pinned is not None:
        db.execute("UPDATE chat_sessions SET pinned = ? WHERE id = ?", (int(pinned), session_id))
    return require_session(session_id)


def reorder_sessions(ids: list[int]) -> list[dict[str, Any]]:
    """Store the operator's manual order. Unknown ids are ignored; sessions not
    listed keep their place after the listed ones."""

    current = [row["id"] for row in db.fetchall("SELECT id FROM chat_sessions ORDER BY position ASC, id DESC")]
    known = set(current)
    listed = [sid for sid in dict.fromkeys(ids) if sid in known]
    placed = set(listed)
    rest = [sid for sid in current if sid not in placed]
    db.executemany(
        "UPDATE chat_sessions SET position = ? WHERE id = ?",
        [(index, sid) for index, sid in enumerate(listed + rest)],
    )
    return list_sessions()


def delete_empty_sessions(keep: int | None = None) -> int:
    """Delete untouched sessions (no messages, never pinned) and return how many went.

    ``keep`` spares one, typically the session the operator has open.
    """

    _, removed = db.execute(
        "DELETE FROM chat_sessions WHERE pinned = 0 AND id != ? "
        "AND NOT EXISTS (SELECT 1 FROM chat_messages m WHERE m.session_id = chat_sessions.id)",
        (keep if keep is not None else -1,),
    )
    return removed


def _clean_title(raw: str) -> str:
    """One tidy line: no labels, quotes, markdown or trailing punctuation."""

    line = next((part for part in raw.strip().splitlines() if part.strip()), "")
    line = re.sub(r"^\s*(title|t[ií]tulo)\s*:\s*", "", line, flags=re.IGNORECASE)
    line = " ".join(line.strip(" \t*#`\"'“”‘’").split()).rstrip(".:;,!")
    if len(line) > TITLE_MAX:
        line = line[:TITLE_MAX].rsplit(" ", 1)[0].rstrip(" ,;:-")
    return line


def _fallback_title(text: str) -> str:
    """The first words of the message, for a first turn that named nothing."""

    words = " ".join(text.split()).split(" ")
    title = _clean_title(" ".join(words[:7]))
    return title[:1].upper() + title[1:] if title else DEFAULT_TITLE


def apply_title(session_id: int, raw: str) -> str | None:
    """Store a first-turn title unless the session already has one of its own.

    Returns the stored title, or None when nothing changed (an empty title, or
    the operator renamed the session meanwhile).
    """

    title = _clean_title(raw)
    if not title or title == DEFAULT_TITLE:
        return None
    _, changed = db.execute(
        "UPDATE chat_sessions SET title = ? WHERE id = ? AND title = ?",
        (title, session_id, DEFAULT_TITLE),
    )
    return title if changed else None


def delete_session(session_id: int) -> None:
    """Delete a session and its messages."""

    require_session(session_id)
    db.execute("DELETE FROM chat_messages WHERE session_id = ?", (session_id,))
    db.execute("DELETE FROM chat_sessions WHERE id = ?", (session_id,))


def add_message(
    session_id: int,
    role: str,
    content: str,
    *,
    tier: str | None = None,
    model: str | None = None,
    tokens_in: int = 0,
    tokens_out: int = 0,
    cost_usd: float = 0.0,
) -> int:
    message_id, _ = db.execute(
        "INSERT INTO chat_messages "
        "(session_id, role, content, created_at, tier, model, tokens_in, tokens_out, cost_usd) "
        "VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)",
        (session_id, role, content, _now_iso(), tier, model, tokens_in, tokens_out, cost_usd),
    )
    db.execute("UPDATE chat_sessions SET updated_at = ? WHERE id = ?", (_now_iso(), session_id))
    return int(message_id or 0)


def _sse(event: str, payload: dict[str, Any]) -> str:
    return f"event: {event}\ndata: {json.dumps(payload, ensure_ascii=False)}\n\n"


def _turn_context(user_id: int | None, text: str) -> str:
    """Extra system-prompt material: the operator's experts and shared memory."""

    if user_id is None:
        return ""
    blocks = [
        brains_service.profiles_for_prompt(user_id, text),
        memory_service.memory_blob_for_prompt(user_id),
    ]
    return "\n\n".join(block for block in blocks if block)


async def stream_reply(session_id: int, text: str, tier: str, user_id: int | None = None) -> AsyncIterator[str]:
    """Persist the turn and yield Server-Sent Events for the reply.

    The first turn of an untitled session also names it: the model writes the
    title in the same call, and the first words of the message stand in when it
    does not. Either way the client gets one ``title`` event before ``done``.
    """

    session = require_session(session_id)
    history = [
        {"role": row["role"], "content": row["content"]}
        for row in db.fetchall(
            "SELECT role, content FROM chat_messages WHERE session_id = ? ORDER BY id ASC",
            (session_id,),
        )
    ]
    add_message(session_id, "user", text)

    want_title = not history and session["title"] == DEFAULT_TITLE
    assistant_text = ""
    route: dict[str, Any] = {}
    saved = False
    try:
        async for event, payload in hybrid.stream_turn(
            text=text,
            history=history,
            tier_request=tier,
            session_id=session_id,
            context=_turn_context(user_id, text),
            want_title=want_title,
        ):
            if event == "title":
                stored = apply_title(session_id, payload.get("title", ""))
                if not stored:
                    continue
                want_title = False
                payload = {"title": stored}
            elif event == "route":
                route = payload
            elif event == "token":
                assistant_text += payload.get("text", "")
            elif event == "done":
                if want_title and (stored := apply_title(session_id, _fallback_title(text))):
                    yield _sse("title", {"title": stored})
                add_message(
                    session_id,
                    "assistant",
                    assistant_text,
                    tier=payload.get("tier"),
                    model=payload.get("model"),
                    tokens_in=int(payload.get("tokens_in", 0)),
                    tokens_out=int(payload.get("tokens_out", 0)),
                    cost_usd=float(payload.get("cost_usd", 0.0)),
                )
                saved = True
            yield _sse(event, payload)
    finally:
        # The operator stopped the reply (the client went away): keep what was
        # said, so the transcript never shows a question with no answer.
        if not saved:
            if want_title:
                apply_title(session_id, _fallback_title(text))
            add_message(
                session_id,
                "assistant",
                f"{assistant_text.rstrip()}\n\n{STOPPED_MARK}" if assistant_text.strip() else STOPPED_MARK,
                tier=route.get("tier"),
                model=route.get("model"),
            )
