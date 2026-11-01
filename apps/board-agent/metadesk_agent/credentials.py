"""Paired-device credentials persisted on the board.

The agent only ever holds the device token the cloud handed out during pairing.
It is written with owner-only permissions and never logged.
"""

from __future__ import annotations

import json
import os
from dataclasses import dataclass
from pathlib import Path

from .config import settings


@dataclass(frozen=True)
class Credentials:
    """What the board needs to open the relay socket."""

    device_id: str
    device_token: str
    cloud_url: str


def load() -> Credentials | None:
    """Return the stored credentials, or ``None`` when the board is unpaired."""

    path = settings.credentials_path
    if not path.exists():
        return None
    try:
        data = json.loads(path.read_text(encoding="utf-8"))
    except (OSError, ValueError):
        return None
    device_id = str(data.get("device_id") or "")
    device_token = str(data.get("device_token") or "")
    if not device_id or not device_token:
        return None
    return Credentials(
        device_id=device_id,
        device_token=device_token,
        cloud_url=str(data.get("cloud_url") or settings.cloud_url),
    )


def save(device_id: str, device_token: str) -> Credentials:
    """Persist freshly paired credentials with owner-only permissions."""

    path = settings.credentials_path
    payload = {"device_id": device_id, "device_token": device_token, "cloud_url": settings.cloud_url}
    path.write_text(json.dumps(payload, indent=2) + "\n", encoding="utf-8")
    _restrict(path)
    return Credentials(device_id=device_id, device_token=device_token, cloud_url=settings.cloud_url)


def clear() -> None:
    """Forget the board's identity so the operator can pair it again."""

    path = settings.credentials_path
    if path.exists():
        path.unlink()


def _restrict(path: Path) -> None:
    """Best-effort owner-only permissions; a no-op where the OS ignores them."""

    try:
        os.chmod(path, 0o600)
    except OSError:
        pass
