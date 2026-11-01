"""Persistence models for chat sessions and messages."""

from __future__ import annotations

from dataclasses import dataclass


@dataclass(slots=True)
class Session:
    id: int
    title: str
    created_at: str


@dataclass(slots=True)
class Message:
    id: int
    session_id: int
    role: str
    content: str
    created_at: str
    tier: str | None = None
    model: str | None = None
    tokens_in: int = 0
    tokens_out: int = 0
    cost_usd: float = 0.0
