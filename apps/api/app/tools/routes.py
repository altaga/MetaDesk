"""Tools routes: web search and its remaining budget."""

from __future__ import annotations

from fastapi import APIRouter, Depends

from ..auth.models import User
from ..auth.service import get_current_user
from ..config import AppError
from .credits import SearchCapReached
from .schemas import SearchRequest
from .tavily import credit_status, web_search

router = APIRouter(prefix="/v1/tools", tags=["tools"])


@router.get("/search/credits")
def search_credits(_user: User = Depends(get_current_user)) -> dict:
    """How much of the board's own search budget is left."""

    return credit_status()


@router.post("/search")
async def search(payload: SearchRequest, _user: User = Depends(get_current_user)) -> dict:
    """Run a web search and return its results."""

    try:
        return await web_search(payload.query)
    except SearchCapReached as exc:
        raise AppError(
            "tavily_credit_cap",
            f"Search credit cap reached ({exc.spent} of {exc.cap}).",
            status_code=402,
        ) from exc
