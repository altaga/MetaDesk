"""Request and response models for the shared memory surface."""

from __future__ import annotations

from pydantic import BaseModel, Field


class MemoryIn(BaseModel):
    """Payload that stores a shared memory file."""

    title: str = Field(default="", max_length=200)
    content: str = Field(min_length=1, max_length=20_000)


class MemoryFileOut(BaseModel):
    """A shared memory file as the operator sees it."""

    id: int
    title: str
    content: str
    created_at: str
    updated_at: str


class DeleteResult(BaseModel):
    """Acknowledgement for a removal."""

    ok: bool = True
