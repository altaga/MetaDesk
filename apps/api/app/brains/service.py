"""Storage and prompt assembly for expert profiles.

A brain owns exactly one markdown profile. The service keeps that file's
shape stable so the chat prompt and the operator UI read the same thing, and
never lets a brain drift into a general note store.
"""

from __future__ import annotations

import re
import uuid
from datetime import datetime, timezone

from .. import db
from ..config import AppError
from .models import Brain, BrainEntry
from .profile import called_names, profile_filename, profile_markdown, profiles_prompt

_WORD = re.compile(r"[a-z0-9]{3,}")

#: The single title a profile entry is allowed to carry.
PROFILE_TITLE = "profile"


def _now_iso() -> str:
    return datetime.now(timezone.utc).isoformat()


def list_brains(user_id: int) -> list[Brain]:
    """Every expert the operator has, sorted by name."""

    rows = db.fetchall("SELECT * FROM brains WHERE user_id = ? ORDER BY name ASC", (user_id,))
    return [Brain.from_row(row) for row in rows]


def get_brain(user_id: int, brain_id: str) -> Brain:
    """One expert, or a 404."""

    row = db.fetchone("SELECT * FROM brains WHERE id = ? AND user_id = ?", (brain_id, user_id))
    if row is None:
        raise AppError("not_found", "Expert not found.", status_code=404, field="brain_id")
    return Brain.from_row(row)


def create_brain(
    user_id: int,
    *,
    name: str,
    description: str = "",
    method: str = "",
    profile: str = "",
    device_id: str | None = None,
) -> Brain:
    """Create an expert and write its initial profile."""

    clean = (name or "").strip()
    if not clean:
        raise AppError("invalid_name", "An expert name is required.", status_code=400, field="name")

    stamp = _now_iso()
    brain_id = str(uuid.uuid4())
    angle = (description or "").strip()[:300]
    db.execute(
        "INSERT INTO brains (id, user_id, device_id, name, description, created_at, updated_at) "
        "VALUES (?, ?, ?, ?, ?, ?, ?)",
        (brain_id, user_id, device_id, clean[:80], angle, stamp, stamp),
    )
    _write_profile(brain_id, profile_markdown(clean[:80], angle, method, profile))
    return get_brain(user_id, brain_id)


def delete_brain(user_id: int, brain_id: str) -> None:
    """Forget an expert and its profile."""

    get_brain(user_id, brain_id)
    db.execute("DELETE FROM brain_entries WHERE brain_id = ?", (brain_id,))
    db.execute("DELETE FROM brains WHERE id = ? AND user_id = ?", (brain_id, user_id))


def add_entry(user_id: int, brain_id: str, *, title: str, body: str) -> BrainEntry:
    """Replace the expert profile. A brain keeps one profile, not notes."""

    brain = get_brain(user_id, brain_id)
    label = (title or "").strip().lower()
    if label not in {"", PROFILE_TITLE}:
        raise AppError(
            "not_a_notebook",
            "An expert holds one profile, not notes.",
            status_code=400,
            field="title",
        )
    pasted = body if label == PROFILE_TITLE else ""
    return _write_profile(brain.id, profile_markdown(brain.name, brain.description, body, pasted))


def profile_body(brain: Brain) -> str:
    """The stored markdown, or a freshly structured default."""

    row = db.fetchone(
        "SELECT * FROM brain_entries WHERE brain_id = ? AND title = ? "
        "ORDER BY updated_at DESC, id DESC LIMIT 1",
        (brain.id, PROFILE_TITLE),
    )
    if row is not None and str(row["body"]).strip():
        return str(row["body"])
    return profile_markdown(brain.name, brain.description, "")


def profiles_for_prompt(user_id: int, content: str, device_id: str | None = None) -> str:
    """Prompt block listing the operator's experts and any called this turn."""

    brains = [brain for brain in list_brains(user_id) if not brain.device_id or brain.device_id == device_id]
    if not brains:
        return ""
    wanted = set(called_names(content, [brain.name for brain in brains]))
    called = [
        (profile_filename(brain.name), profile_body(brain))
        for brain in brains
        if brain.name in wanted
    ]
    return profiles_prompt([brain.name for brain in brains], called)


def delete_entry(user_id: int, brain_id: str, entry_id: int) -> None:
    """Remove one stored profile entry by id."""

    get_brain(user_id, brain_id)
    _, rowcount = db.execute(
        "DELETE FROM brain_entries WHERE id = ? AND brain_id = ?", (entry_id, brain_id)
    )
    if not rowcount:
        raise AppError("not_found", "Entry not found.", status_code=404, field="entry_id")


def search_profiles(user_id: int, query: str, *, brain_name: str = "", limit: int = 4) -> list[Brain]:
    """Rank experts by how many query words they mention."""

    words = set(_WORD.findall((query or "").lower()))
    brains = list_brains(user_id)
    if brain_name:
        brains = [brain for brain in brains if brain.name.lower() == brain_name.lower()]
    if not words:
        return brains[:limit]
    scored: list[tuple[int, Brain]] = []
    for brain in brains:
        hay = f"{brain.name}\n{brain.description}\n{profile_body(brain)}".lower()
        score = sum(1 for word in words if word in hay)
        if score:
            scored.append((score, brain))
    scored.sort(key=lambda item: item[0], reverse=True)
    return [brain for _, brain in scored[:limit]]


def _write_profile(brain_id: str, markdown: str) -> BrainEntry:
    """Replace the brain's single profile and bump its timestamp."""

    stamp = _now_iso()
    db.execute("DELETE FROM brain_entries WHERE brain_id = ?", (brain_id,))
    entry_id, _ = db.execute(
        "INSERT INTO brain_entries (brain_id, title, body, updated_at) VALUES (?, ?, ?, ?)",
        (brain_id, PROFILE_TITLE, markdown, stamp),
    )
    db.execute("UPDATE brains SET updated_at = ? WHERE id = ?", (stamp, brain_id))
    return BrainEntry(
        id=int(entry_id or 0),
        brain_id=brain_id,
        title=PROFILE_TITLE,
        body=markdown,
        updated_at=stamp,
    )
