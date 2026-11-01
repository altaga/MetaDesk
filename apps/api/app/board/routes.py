"""Board routes: host description and live health."""

from __future__ import annotations

from typing import Any

from fastapi import APIRouter, Depends

from ..auth.service import get_current_user
from . import metrics

router = APIRouter(prefix="/v1/board", tags=["board"], dependencies=[Depends(get_current_user)])


@router.get("/info")
def info() -> dict[str, Any]:
    """Describe the board that hosts the desk brain."""

    return metrics.board_info()


@router.get("/health")
def health() -> dict[str, Any]:
    """Return live CPU, memory, disk, thermal and GPU telemetry."""

    return metrics.board_health()
