"""How the board reaches the central service.

Pairing writes the device token into the agent's state directory; the API reads
the same file so both processes share one board identity. Only the device token
is ever held here — provider keys stay in the cloud.
"""

from __future__ import annotations

import json

from .config import settings

_DEVICE_FILE = "device.json"


def _device_record() -> dict:
    """Best-effort read of the paired-device file. Never raises."""

    try:
        raw = (settings.state_path / _DEVICE_FILE).read_text(encoding="utf-8")
    except OSError:
        return {}
    try:
        data = json.loads(raw)
    except ValueError:
        return {}
    return data if isinstance(data, dict) else {}


def cloud_config() -> tuple[str, str] | None:
    """Return ``(cloud base url, device token)`` or ``None`` when unpaired."""

    saved = _device_record()
    url = str(saved.get("cloud_url") or "") or settings.cloud_url
    token = settings.desk_device_token or str(saved.get("device_token") or "")
    base = url.rstrip("/")
    if base and token:
        return base, token
    return None
