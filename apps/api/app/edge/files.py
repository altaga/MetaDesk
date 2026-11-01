"""Filesystem helpers confined to the desk root.

Every path the desk reads or writes goes through here, so a job or tool can
never reach outside the sandbox.
"""

from __future__ import annotations

from pathlib import Path

from ..config import desk_root_abs, resolve_under_root


def fs_root() -> Path:
    """The sandbox root every file operation is confined to."""

    return desk_root_abs()


def resolve_path(relative: str) -> Path:
    """Resolve ``relative`` inside the desk root, rejecting any escape."""

    return resolve_under_root(relative)


def write_file(relative: str, content: str) -> Path:
    """Write text under the desk root, creating parent directories."""

    target = resolve_under_root(relative)
    target.parent.mkdir(parents=True, exist_ok=True)
    target.write_text(content, encoding="utf-8")
    return target
