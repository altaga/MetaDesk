"""Request and response models for the chat endpoints."""

from __future__ import annotations

from typing import Literal

from pydantic import BaseModel, Field

TierChoice = Literal["auto", "local", "fast", "heavy", "ultra"]


class SessionCreate(BaseModel):
    title: str | None = Field(default=None, max_length=200)


class SessionUpdate(BaseModel):
    """Any of a session's own settings; fields left out stay as they are."""

    title: str | None = Field(default=None, min_length=1, max_length=120)
    pinned: bool | None = None


class SessionOrder(BaseModel):
    """Session ids in the order the operator arranged them, top first."""

    ids: list[int] = Field(max_length=1000)


class StreamMessageRequest(BaseModel):
    session_id: int = Field(ge=1)
    text: str = Field(min_length=1)
    tier: TierChoice = "auto"
