"""Ops routes: the board's own view of what it has been doing."""

from __future__ import annotations

from fastapi import APIRouter, Depends

from ..auth.models import User
from ..auth.service import get_current_user
from .local import summary

router = APIRouter(prefix="/v1/ops", tags=["ops"])


@router.get("/summary")
def ops_summary(hours: float = 24.0, _user: User = Depends(get_current_user)) -> dict:
    """Aggregated board-local ops. Works even when cloud ingest is down."""

    return summary(hours=hours)
