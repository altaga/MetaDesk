"""User persistence, authentication and the current-user dependency."""

from __future__ import annotations

from datetime import datetime, timezone

from fastapi import Depends
from fastapi.security import HTTPAuthorizationCredentials, HTTPBearer

from .. import db
from ..config import AppError, settings
from . import security
from .models import User

_bearer = HTTPBearer(auto_error=False)


def _now_iso() -> str:
    return datetime.now(timezone.utc).isoformat()


def get_user_by_username(username: str) -> User | None:
    row = db.fetchone("SELECT * FROM users WHERE username = ?", (username,))
    return User.from_row(row) if row else None


def create_user(username: str, password: str) -> User:
    db.execute(
        "INSERT INTO users (username, password_hash, created_at) VALUES (?, ?, ?)",
        (username, security.hash_password(password), _now_iso()),
    )
    created = get_user_by_username(username)
    if created is None:  # pragma: no cover - defensive, insert just succeeded
        raise AppError("user_creation_failed", "Could not create the user.", status_code=500)
    return created


def ensure_bootstrap_user() -> None:
    """Create the bootstrap operator the first time the board boots."""

    row = db.fetchone("SELECT COUNT(*) AS total FROM users")
    if row and int(row["total"]) > 0:
        return
    create_user(settings.bootstrap_username, settings.bootstrap_password)


def authenticate(username: str, password: str) -> User | None:
    user = get_user_by_username(username)
    if user is None:
        return None
    if not security.verify_password(password, user.password_hash):
        return None
    return user


def get_current_user(
    credentials: HTTPAuthorizationCredentials | None = Depends(_bearer),
) -> User:
    """FastAPI dependency resolving the bearer token into a user."""

    if credentials is None or not credentials.credentials:
        raise AppError("unauthorized", "Missing bearer token.", status_code=401)
    try:
        payload = security.decode_access_token(credentials.credentials)
    except Exception as exc:  # noqa: BLE001 - any JWT failure means unauthorized
        raise AppError("unauthorized", "Invalid or expired token.", status_code=401) from exc
    username = payload.get("sub")
    if not username:
        raise AppError("unauthorized", "Token is missing a subject.", status_code=401)
    user = get_user_by_username(str(username))
    if user is None:
        raise AppError("unauthorized", "Unknown operator.", status_code=401)
    return user
