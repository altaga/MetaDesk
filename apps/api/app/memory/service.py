"""Storage and prompt assembly for the board's shared memory."""

from __future__ import annotations

from datetime import datetime, timezone

from .. import db
from ..config import AppError
from .memory_md import memory_filename, memory_prompt, structure_memory
from .models import MemoryFile


def _now_iso() -> str:
    return datetime.now(timezone.utc).isoformat()


def list_memory(user_id: int) -> list[MemoryFile]:
    """Every shared memory file, most recently touched first."""

    rows = db.fetchall(
        "SELECT * FROM device_memory WHERE user_id = ? ORDER BY updated_at DESC, id DESC",
        (user_id,),
    )
    return [MemoryFile.from_row(row) for row in rows]


def get_memory(user_id: int, memory_id: int) -> MemoryFile:
    """One memory file, or a 404."""

    row = db.fetchone(
        "SELECT * FROM device_memory WHERE id = ? AND user_id = ?", (memory_id, user_id)
    )
    if row is None:
        raise AppError("not_found", "Memory not found.", status_code=404, field="memory_id")
    return MemoryFile.from_row(row)


def add_memory(user_id: int, *, title: str, content: str) -> MemoryFile:
    """Store a fact as a shared memory file."""

    if not (content or "").strip():
        raise AppError("invalid_fact", "A fact is required.", status_code=400, field="content")
    name, markdown = structure_memory(title, content)
    stamp = _now_iso()
    memory_id, _ = db.execute(
        "INSERT INTO device_memory (user_id, title, content, created_at, updated_at) "
        "VALUES (?, ?, ?, ?, ?)",
        (user_id, name[:200], markdown, stamp, stamp),
    )
    return get_memory(user_id, int(memory_id or 0))


def delete_memory(user_id: int, memory_id: int) -> None:
    """Forget a shared memory file."""

    get_memory(user_id, memory_id)
    db.execute("DELETE FROM device_memory WHERE id = ? AND user_id = ?", (memory_id, user_id))


def memory_blob_for_prompt(user_id: int, *, limit: int = 12) -> str:
    """The most recent shared memory as markdown files for the system prompt."""

    files = [
        (memory_filename(entry.title), entry.content)
        for entry in reversed(list_memory(user_id)[:limit])
    ]
    return memory_prompt(files)
