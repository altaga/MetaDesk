"""Row shape for a shared memory file."""

from __future__ import annotations

from dataclasses import dataclass


@dataclass(slots=True)
class MemoryFile:
    """One shared memory file the board keeps for every chat."""

    id: int
    user_id: int
    title: str
    content: str
    created_at: str
    updated_at: str

    @classmethod
    def from_row(cls, row: dict) -> "MemoryFile":
        return cls(
            id=int(row["id"]),
            user_id=int(row["user_id"]),
            title=str(row["title"]),
            content=str(row["content"]),
            created_at=str(row["created_at"]),
            updated_at=str(row["updated_at"]),
        )
