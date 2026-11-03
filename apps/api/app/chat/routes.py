"""Chat routes: sessions and streaming replies."""

from __future__ import annotations

from typing import Any

from fastapi import APIRouter, Depends
from fastapi.responses import StreamingResponse

from ..auth.models import User
from ..auth.service import get_current_user
from . import approvals, service
from .schemas import ApprovalDecision, SessionCreate, SessionOrder, SessionUpdate, StreamMessageRequest

router = APIRouter(prefix="/v1/chat", tags=["chat"], dependencies=[Depends(get_current_user)])


@router.post("/sessions")
def create_session(payload: SessionCreate) -> dict[str, Any]:
    """Create a new chat session."""

    return {"ok": True, "session": service.create_session(payload.title)}


@router.get("/sessions")
def list_sessions() -> dict[str, Any]:
    """List chat sessions, newest first."""

    return {"ok": True, "sessions": service.list_sessions()}


@router.get("/sessions/{session_id}/messages")
def list_messages(session_id: int) -> dict[str, Any]:
    """List the messages of a session."""

    return {"ok": True, "messages": service.list_messages(session_id)}


@router.put("/sessions/order")
def reorder_sessions(payload: SessionOrder) -> dict[str, Any]:
    """Save the operator's manual session order."""

    return {"ok": True, "sessions": service.reorder_sessions(payload.ids)}


@router.delete("/sessions/empty")
def delete_empty_sessions(keep: int | None = None) -> dict[str, Any]:
    """Delete sessions that never got a message (pinned ones stay)."""

    return {"ok": True, "deleted": service.delete_empty_sessions(keep)}


@router.patch("/sessions/{session_id}")
def update_session(session_id: int, payload: SessionUpdate) -> dict[str, Any]:
    """Rename and/or pin a session."""

    session = service.update_session(session_id, title=payload.title, pinned=payload.pinned)
    return {"ok": True, "session": session}


@router.delete("/sessions/{session_id}")
def delete_session(session_id: int) -> dict[str, Any]:
    """Delete a session and every message it contains."""

    service.delete_session(session_id)
    return {"ok": True, "deleted": session_id}


@router.post("/approvals/{approval_id}")
def decide_approval(approval_id: str, payload: ApprovalDecision) -> dict[str, Any]:
    """Approve (write) or deny a file change the agent proposed with a ``patch`` fence."""

    return {"ok": True, "result": approvals.decide(approval_id, payload.approve)}


@router.post("/message/stream")
def stream_message(
    payload: StreamMessageRequest, user: User = Depends(get_current_user)
) -> StreamingResponse:
    """Stream a reply as Server-Sent Events."""

    service.require_session(payload.session_id)
    generator = service.stream_reply(payload.session_id, payload.text, payload.tier, user.id)
    return StreamingResponse(
        generator,
        media_type="text/event-stream",
        headers={"Cache-Control": "no-cache", "X-Accel-Buffering": "no"},
    )
