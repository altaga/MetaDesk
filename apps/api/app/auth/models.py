"""User records for the MetaDesk board API."""

from __future__ import annotations

from dataclasses import dataclass


@dataclass(slots=True)
class User:
    """A board operator account."""

    id: int
    username: str
    password_hash: str
    created_at: str

    @classmethod
    def from_row(cls, row: dict) -> "User":
        return cls(
            id=int(row["id"]),
            username=str(row["username"]),
            password_hash=str(row["password_hash"]),
            created_at=str(row["created_at"]),
        )
