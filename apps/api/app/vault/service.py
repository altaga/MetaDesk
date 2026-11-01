"""Storage and validation for the desk vault.

Values are encrypted before they touch SQLite. Callers that need the plain
value (the shell bridge and the chat tools) go through :func:`secret_map`.
"""

from __future__ import annotations

import re
from datetime import datetime, timezone

from .. import db
from ..config import AppError
from .crypto import decrypt_value, encrypt_value

#: A secret name has to be a plausible, portable shell variable identifier.
_NAME_RE = re.compile(r"^[A-Za-z_][A-Za-z0-9_]{0,63}$")

#: Names that would let a stored secret hijack a spawned process.
_BLOCKED_NAMES = frozenset(
    {
        "PATH",
        "HOME",
        "SHELL",
        "IFS",
        "ENV",
        "BASH_ENV",
        "LD_PRELOAD",
        "LD_LIBRARY_PATH",
        "PYTHONPATH",
        "NODE_OPTIONS",
        "SSLKEYLOGFILE",
    }
)

_MAX_VALUE_LEN = 8000


def _now_iso() -> str:
    return datetime.now(timezone.utc).isoformat()


def _clean_name(name: str) -> str:
    """Validate a secret name, raising :class:`AppError` when it is unusable."""

    clean = (name or "").strip()
    if not _NAME_RE.match(clean):
        raise AppError(
            "invalid_secret_name",
            "Use letters, digits and underscores, not starting with a digit, like GITHUB_TOKEN.",
            status_code=400,
            field="name",
        )
    if clean.upper() in _BLOCKED_NAMES:
        raise AppError(
            "invalid_secret_name",
            f"{clean} is reserved by the shell, so it cannot hold a secret. Pick another name.",
            status_code=400,
            field="name",
        )
    return clean


def list_names(user_id: int) -> list[str]:
    """Every secret name the operator has stored, sorted alphabetically."""

    rows = db.fetchall("SELECT name FROM desk_secrets WHERE user_id = ? ORDER BY name ASC", (user_id,))
    return [str(row["name"]) for row in rows]


def put_secret(user_id: int, name: str, value: str) -> str:
    """Store a secret, or rotate the value when the name already exists."""

    clean = _clean_name(name)
    if not value or len(value) > _MAX_VALUE_LEN:
        raise AppError(
            "invalid_secret_value",
            "The secret value is empty or too long.",
            status_code=400,
            field="value",
        )

    ciphertext = encrypt_value(value)
    stamp = _now_iso()
    existing = db.fetchone("SELECT id FROM desk_secrets WHERE user_id = ? AND name = ?", (user_id, clean))
    if existing is None:
        db.execute(
            "INSERT INTO desk_secrets (user_id, name, ciphertext, created_at, updated_at) VALUES (?, ?, ?, ?, ?)",
            (user_id, clean, ciphertext, stamp, stamp),
        )
    else:
        db.execute(
            "UPDATE desk_secrets SET ciphertext = ?, updated_at = ? WHERE id = ?",
            (ciphertext, stamp, int(existing["id"])),
        )
    return clean


def delete_secret(user_id: int, name: str) -> None:
    """Forget a stored secret."""

    clean = _clean_name(name)
    db.execute("DELETE FROM desk_secrets WHERE user_id = ? AND name = ?", (user_id, clean))


def secret_map(user_id: int | None = None) -> dict[str, str]:
    """Decrypted secrets as a ``name -> value`` map.

    Without a ``user_id`` every row is included, which is what the local board
    agent needs when it injects the operator's keychain into a shell.
    """

    if user_id is None:
        rows = db.fetchall("SELECT name, ciphertext FROM desk_secrets")
    else:
        rows = db.fetchall("SELECT name, ciphertext FROM desk_secrets WHERE user_id = ?", (user_id,))

    found: dict[str, str] = {}
    for row in rows:
        plain = decrypt_value(str(row["ciphertext"]))
        if plain:
            found[str(row["name"])] = plain
    return found


def secret_values(user_id: int | None = None) -> list[str]:
    """Every decrypted value, shaped for the redaction filter."""

    return list(secret_map(user_id).values())
