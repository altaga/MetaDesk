"""Mint short-lived board tokens for relayed requests.

The relay only tells the agent *who* the operator is; the board API still wants
its own bearer token. The agent re-signs one per request with the board's shared
``JWT_SECRET``, so the board never has to trust an identity it cannot verify.
"""

from __future__ import annotations

from datetime import datetime, timedelta, timezone

import jwt

from .config import settings

_ALGORITHM = "HS256"


def for_operator(username: str) -> str:
    """Issue a board access token for ``username``."""

    now = datetime.now(timezone.utc)
    payload = {
        "sub": username,
        "iat": int(now.timestamp()),
        "exp": int((now + timedelta(minutes=settings.jwt_expire_minutes)).timestamp()),
    }
    return jwt.encode(payload, settings.jwt_secret, algorithm=_ALGORITHM)
