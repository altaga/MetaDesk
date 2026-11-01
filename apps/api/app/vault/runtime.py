"""Local-only vault access for the board agent. Not mounted over HTTP."""

from __future__ import annotations

from .service import secret_map


def export_map() -> dict[str, str]:
    """Every stored secret as a plain ``name -> value`` map."""

    return secret_map()
