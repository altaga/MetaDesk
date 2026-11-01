"""Lifetime search credit cap for the board's own key.

One basic search costs one credit. Spends are committed before the HTTP call
and refunded if the call fails, so a flaky provider cannot burn the budget.
"""

from __future__ import annotations

import threading

from .. import db

_LOCK = threading.Lock()

BASIC_SEARCH_CREDITS = 1


class SearchCapReached(Exception):
    """Raised when a spend would push the board past its lifetime cap."""

    def __init__(self, spent: int, cap: int) -> None:
        self.spent = spent
        self.cap = cap
        super().__init__(f"Search credit cap reached ({spent} of {cap}).")


def credits_spent() -> int:
    """Total credits consumed so far. Refunds subtract."""

    row = db.fetchone("SELECT COALESCE(SUM(credits), 0) AS total FROM tavily_ledger")
    return int(row["total"]) if row and row["total"] is not None else 0


def credits_remaining(cap: int) -> int:
    """Credits left under ``cap``."""

    return max(0, cap - credits_spent())


def reserve(cap: int, cost: int, note: str) -> int:
    """Commit a spend. Returns credits left after it, or raises when capped."""

    with _LOCK:
        spent = credits_spent()
        if spent + cost > cap:
            raise SearchCapReached(spent, cap)
        db.execute("INSERT INTO tavily_ledger (credits, note) VALUES (?, ?)", (cost, note[:200]))
        return cap - (spent + cost)


def refund(cost: int, note: str) -> None:
    """Give back credits for a call that never succeeded."""

    with _LOCK:
        db.execute("INSERT INTO tavily_ledger (credits, note) VALUES (?, ?)", (-cost, f"refund:{note}"[:200]))
