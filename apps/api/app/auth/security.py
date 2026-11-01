"""Password hashing and JSON Web Token helpers."""

from __future__ import annotations

import hashlib
import hmac
import os
from datetime import datetime, timedelta, timezone

import jwt

from ..config import settings

_ALGORITHM = "HS256"
_PBKDF2_ITERATIONS = 240_000


def hash_password(password: str, iterations: int = _PBKDF2_ITERATIONS) -> str:
    """Hash a password with PBKDF2-HMAC-SHA256 and a fresh random salt."""

    salt = os.urandom(16)
    digest = hashlib.pbkdf2_hmac("sha256", password.encode("utf-8"), salt, iterations)
    return f"pbkdf2_sha256${iterations}${salt.hex()}${digest.hex()}"


def verify_password(password: str, stored: str) -> bool:
    """Constant-time verification of a password against a stored hash."""

    try:
        algorithm, iterations_raw, salt_hex, digest_hex = stored.split("$")
        if algorithm != "pbkdf2_sha256":
            return False
        iterations = int(iterations_raw)
        salt = bytes.fromhex(salt_hex)
    except (ValueError, AttributeError):
        return False
    computed = hashlib.pbkdf2_hmac("sha256", password.encode("utf-8"), salt, iterations)
    return hmac.compare_digest(computed.hex(), digest_hex)


def create_access_token(username: str) -> str:
    """Issue a signed access token for ``username``."""

    now = datetime.now(timezone.utc)
    expires_at = now + timedelta(minutes=settings.jwt_expire_minutes)
    payload = {
        "sub": username,
        "iat": int(now.timestamp()),
        "exp": int(expires_at.timestamp()),
    }
    return jwt.encode(payload, settings.jwt_secret, algorithm=_ALGORITHM)


def decode_access_token(token: str) -> dict:
    """Decode and validate a token, raising ``jwt.PyJWTError`` on failure."""

    return jwt.decode(token, settings.jwt_secret, algorithms=[_ALGORITHM])


def access_token_ttl_seconds() -> int:
    """Lifetime of an access token, in seconds."""

    return int(settings.jwt_expire_minutes) * 60
