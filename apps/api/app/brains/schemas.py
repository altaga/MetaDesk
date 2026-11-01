"""Request and response models for the experts surface."""

from __future__ import annotations

from pydantic import BaseModel, Field


class BrainIn(BaseModel):
    """Payload that creates an expert profile."""

    name: str = Field(min_length=1, max_length=80)
    description: str = Field(default="", max_length=300)
    method: str = Field(default="", max_length=20_000)
    profile: str = Field(default="", max_length=20_000)
    device_id: str | None = None


class EntryIn(BaseModel):
    """Payload that replaces the single stored profile."""

    title: str = Field(default="", max_length=200)
    body: str = Field(min_length=1, max_length=20_000)


class EntryOut(BaseModel):
    """A stored profile entry."""

    id: int
    title: str
    body: str
    updated_at: str | None = None


class BrainOut(BaseModel):
    """An expert profile as the operator sees it."""

    id: str
    name: str
    description: str
    device_id: str | None = None
    profile: str = ""
    entries: list[EntryOut] = Field(default_factory=list)
