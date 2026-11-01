"""Symmetric encryption for stored secret values.

The key is derived from the board's ``JWT_SECRET``, so a vault copied to a
different board is unreadable. Derivation is salted with a fixed,
vault-specific label to keep the encryption key separate from the signing key.
"""

from __future__ import annotations

import base64
import hashlib

from cryptography.fernet import Fernet, InvalidToken

from ..config import settings

#: Domain-separation label mixed into the key derivation.
_SALT = b"metadesk-vault-v1"

#: PBKDF2 work factor. High enough to slow brute force, low enough to stay snappy.
_ROUNDS = 120_000


def _cipher() -> Fernet:
    """Build the Fernet instance for the configured secret."""

    material = hashlib.pbkdf2_hmac(
        "sha256",
        settings.jwt_secret.encode("utf-8"),
        _SALT,
        _ROUNDS,
        dklen=32,
    )
    return Fernet(base64.urlsafe_b64encode(material))


def encrypt_value(plain: str) -> str:
    """Return the ciphertext token for ``plain``."""

    return _cipher().encrypt(plain.encode("utf-8")).decode("ascii")


def decrypt_value(ciphertext: str) -> str | None:
    """Recover the plain value, or ``None`` when the token cannot be read.

    A ``None`` here usually means the board's ``JWT_SECRET`` changed since the
    secret was stored, which makes the old ciphertext unrecoverable by design.
    """

    try:
        return _cipher().decrypt(ciphertext.encode("ascii")).decode("utf-8")
    except (InvalidToken, ValueError, UnicodeError):
        return None
