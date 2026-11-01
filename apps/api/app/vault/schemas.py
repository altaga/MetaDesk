"""Request and response models for the vault surface."""

from __future__ import annotations

from pydantic import BaseModel, Field


class SecretName(BaseModel):
    """A stored secret's name. The value never leaves the board."""

    name: str


class PutSecretRequest(BaseModel):
    """Payload that stores a value, or rotates the one already on file."""

    name: str = Field(min_length=1, max_length=64)
    value: str = Field(min_length=1, max_length=8000)


class DeleteResult(BaseModel):
    """Acknowledgement for a removal."""

    ok: bool = True
