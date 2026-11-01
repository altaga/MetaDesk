"""Memory routes: list, store and forget the board's shared memory."""

from __future__ import annotations

from fastapi import APIRouter, Depends

from ..auth.models import User
from ..auth.service import get_current_user
from . import service
from .schemas import DeleteResult, MemoryFileOut, MemoryIn

router = APIRouter(prefix="/v1/memory", tags=["memory"])


def _out(entry: service.MemoryFile) -> MemoryFileOut:
    return MemoryFileOut(
        id=entry.id,
        title=entry.title,
        content=entry.content,
        created_at=entry.created_at,
        updated_at=entry.updated_at,
    )


@router.get("", response_model=list[MemoryFileOut])
def list_memory(user: User = Depends(get_current_user)) -> list[MemoryFileOut]:
    """List the board's shared memory files."""

    return [_out(entry) for entry in service.list_memory(user.id)]


@router.post("", response_model=MemoryFileOut)
def add_memory(payload: MemoryIn, user: User = Depends(get_current_user)) -> MemoryFileOut:
    """Store a fact as a shared memory file every chat can read."""

    return _out(service.add_memory(user.id, title=payload.title, content=payload.content))


@router.delete("/{memory_id}", response_model=DeleteResult)
def delete_memory(memory_id: int, user: User = Depends(get_current_user)) -> DeleteResult:
    """Forget a shared memory file."""

    service.delete_memory(user.id, memory_id)
    return DeleteResult()
