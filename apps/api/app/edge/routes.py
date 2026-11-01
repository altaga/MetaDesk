"""Edge routes: sandboxed file listing and reading under the desk root."""

from __future__ import annotations

from typing import Any

from fastapi import APIRouter, Depends, Query

from ..auth.service import get_current_user
from ..chat.desk_tools import READ_CAP_BYTES
from ..config import AppError, resolve_under_root

router = APIRouter(prefix="/v1/edge", tags=["edge"], dependencies=[Depends(get_current_user)])


def _relative(path: str) -> str:
    return path.strip() or "."


@router.get("/files")
def list_files(path: str = Query(default=".")) -> dict[str, Any]:
    """List a directory inside the desk root."""

    relative = _relative(path)
    target = resolve_under_root(relative)
    if not target.exists():
        raise AppError("not_found", "The requested path does not exist.", status_code=404, field="path")
    if not target.is_dir():
        raise AppError("not_a_directory", "The requested path is not a directory.", status_code=400, field="path")

    entries = []
    for child in sorted(target.iterdir(), key=lambda item: item.name.lower()):
        is_dir = child.is_dir()
        entries.append(
            {
                "name": child.name,
                "type": "dir" if is_dir else "file",
                "size": 0 if is_dir else child.stat().st_size,
            }
        )
    return {"ok": True, "path": relative, "entries": entries}


@router.get("/files/read")
def read_file(path: str = Query(...)) -> dict[str, Any]:
    """Read a text file inside the desk root, capped at 256 KB."""

    relative = _relative(path)
    target = resolve_under_root(relative)
    if not target.exists():
        raise AppError("not_found", "The requested path does not exist.", status_code=404, field="path")
    if not target.is_file():
        raise AppError("not_a_file", "The requested path is not a file.", status_code=400, field="path")

    size = target.stat().st_size
    with target.open("rb") as handle:
        raw = handle.read(READ_CAP_BYTES)
    return {
        "ok": True,
        "path": relative,
        "content": raw.decode("utf-8", errors="replace"),
        "truncated": size > READ_CAP_BYTES,
    }
