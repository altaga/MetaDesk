"""File changes the desk agent proposed and the operator has not decided yet.

A ``patch`` fence never writes on its own: it parks the change here and the
chat shows the operator a diff. Only an approval writes the file, and it
re-checks the original text first so a stale proposal cannot clobber edits made
in between. Pending changes live in memory: a board restart drops them, which
is the safe direction.
"""

from __future__ import annotations

import secrets
import time
from dataclasses import dataclass
from typing import Any

from ..config import AppError, resolve_under_root

#: How long a proposal waits for a decision before it lapses.
TTL_SECONDS = 30 * 60
MAX_PENDING = 50


@dataclass
class Proposal:
    id: str
    path: str
    old: str
    new: str
    created: float


_pending: dict[str, Proposal] = {}


def _prune() -> None:
    cutoff = time.time() - TTL_SECONDS
    for key in [key for key, item in _pending.items() if item.created < cutoff]:
        del _pending[key]
    while len(_pending) > MAX_PENDING:
        del _pending[next(iter(_pending))]


def _check(path: str, old: str) -> tuple[Any, str] | dict[str, Any]:
    """Resolve the file and confirm ``old`` occurs exactly once; an error event otherwise."""

    try:
        target = resolve_under_root(path)
    except AppError as exc:
        return {"name": "patch", "status": "error", "reason": exc.code, "path": path}
    if not target.is_file():
        return {"name": "patch", "status": "error", "reason": "not_a_file", "path": path}
    text = target.read_text(encoding="utf-8", errors="replace")
    count = text.count(old) if old else 0
    if count != 1:
        reason = "search_not_found" if count == 0 else "search_not_unique"
        return {"name": "patch", "status": "error", "reason": reason, "path": path}
    return target, text


def propose(path: str, old: str, new: str) -> dict[str, Any]:
    """Park a change and return the ``pending`` tool event the chat renders."""

    checked = _check(path, old)
    if isinstance(checked, dict):
        return checked
    if old == new:
        return {"name": "patch", "status": "error", "reason": "no_change", "path": path}
    _prune()
    proposal = Proposal(id=secrets.token_urlsafe(9), path=path, old=old, new=new, created=time.time())
    _pending[proposal.id] = proposal
    return {
        "name": "patch",
        "status": "pending",
        "approval_id": proposal.id,
        "path": path,
        "old": old,
        "new": new,
    }


def decide(approval_id: str, approve: bool) -> dict[str, Any]:
    """Apply or drop a proposal; the result is the tool event that replaces the pending one."""

    _prune()
    proposal = _pending.pop(approval_id, None)
    if proposal is None:
        raise AppError("not_found", "That change is no longer waiting for approval.", status_code=404)
    if not approve:
        return {"name": "patch", "status": "denied", "path": proposal.path}
    checked = _check(proposal.path, proposal.old)
    if isinstance(checked, dict):
        # The file changed since the proposal; nothing is written.
        return {**checked, "reason": "file_changed"}
    target, text = checked
    target.write_text(text.replace(proposal.old, proposal.new, 1), encoding="utf-8")
    return {"name": "patch", "status": "ok", "path": proposal.path, "old": proposal.old, "new": proposal.new}
