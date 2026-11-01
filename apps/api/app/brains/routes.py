"""Experts routes: list, create, delete, and the single stored profile."""

from __future__ import annotations

from fastapi import APIRouter, Depends

from ..auth.models import User
from ..auth.service import get_current_user
from . import service
from .mcp import handle as mcp_handle
from .models import Brain
from .schemas import BrainIn, BrainOut, EntryIn, EntryOut

router = APIRouter(prefix="/v1/brains", tags=["brains"])


def _out(brain: Brain) -> BrainOut:
    return BrainOut(
        id=brain.id,
        name=brain.name,
        description=brain.description,
        device_id=brain.device_id,
        profile=service.profile_body(brain),
    )


@router.get("", response_model=list[BrainOut])
def api_list_brains(user: User = Depends(get_current_user)) -> list[BrainOut]:
    """List the operator's expert profiles."""

    return [_out(brain) for brain in service.list_brains(user.id)]


@router.post("", response_model=BrainOut)
def api_create_brain(payload: BrainIn, user: User = Depends(get_current_user)) -> BrainOut:
    """Create an expert from a name, an angle and an optional method."""

    brain = service.create_brain(
        user.id,
        name=payload.name,
        description=payload.description,
        method=payload.method,
        profile=payload.profile,
        device_id=payload.device_id,
    )
    return _out(brain)


@router.delete("/{brain_id}")
def api_delete_brain(brain_id: str, user: User = Depends(get_current_user)) -> dict:
    """Forget an expert."""

    service.delete_brain(user.id, brain_id)
    return {"ok": True}


@router.post("/{brain_id}/entries", response_model=EntryOut)
def api_add_entry(
    brain_id: str, payload: EntryIn, user: User = Depends(get_current_user)
) -> EntryOut:
    """Replace the expert profile."""

    entry = service.add_entry(user.id, brain_id, title=payload.title, body=payload.body)
    return EntryOut(id=entry.id, title=entry.title, body=entry.body, updated_at=entry.updated_at)


@router.delete("/{brain_id}/entries/{entry_id}")
def api_delete_entry(
    brain_id: str, entry_id: int, user: User = Depends(get_current_user)
) -> dict:
    """Remove one stored profile entry."""

    service.delete_entry(user.id, brain_id, entry_id)
    return {"ok": True}


@router.post("/mcp")
def api_brains_mcp(message: dict, user: User = Depends(get_current_user)) -> dict:
    """MCP endpoint for external agents: list, search and read experts."""

    return mcp_handle(user.id, message)
