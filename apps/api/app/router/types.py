"""Shared routing types."""

from __future__ import annotations

from dataclasses import dataclass

#: The tiers understood by the router, cheapest to most capable.
TIERS = ("local", "fast", "heavy", "ultra")

#: Tiers that run on the Meta Model API (everything except ``local``).
CLOUD_TIERS = ("fast", "heavy", "ultra")


@dataclass(slots=True)
class RouteDecision:
    """The resolved tier for a single turn."""

    tier: str
    reason: str
    model: str
