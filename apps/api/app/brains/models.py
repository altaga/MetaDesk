"""Row shapes for expert profiles and their stored markdown."""

from __future__ import annotations

from dataclasses import dataclass


@dataclass(slots=True)
class Brain:
    """One expert profile the operator can call into a conversation."""

    id: str
    user_id: int
    device_id: str | None
    name: str
    description: str
    created_at: str
    updated_at: str

    @classmethod
    def from_row(cls, row: dict) -> "Brain":
        return cls(
            id=str(row["id"]),
            user_id=int(row["user_id"]),
            device_id=row.get("device_id") or None,
            name=str(row["name"]),
            description=str(row.get("description") or ""),
            created_at=str(row["created_at"]),
            updated_at=str(row["updated_at"]),
        )


@dataclass(slots=True)
class BrainEntry:
    """The markdown profile a brain holds. Exactly one is kept per brain."""

    id: int
    brain_id: str
    title: str
    body: str
    updated_at: str

    @classmethod
    def from_row(cls, row: dict) -> "BrainEntry":
        return cls(
            id=int(row["id"]),
            brain_id=str(row["brain_id"]),
            title=str(row["title"]),
            body=str(row["body"]),
            updated_at=str(row["updated_at"]),
        )
