"""Request models for the tools surface."""

from __future__ import annotations

from pydantic import BaseModel, Field


class SearchRequest(BaseModel):
    """A web search the desk should run."""

    query: str = Field(min_length=1, max_length=500)
