"""Board-local ops ring, used when cloud ingest is offline."""

from __future__ import annotations

import threading
import time
from collections import Counter, deque
from typing import Any

_LOCK = threading.Lock()
_RING: deque[dict[str, Any]] = deque(maxlen=500)


def record_local(event: dict[str, Any]) -> None:
    """Append a trimmed copy of ``event`` to the ring."""

    row = {
        "ts": time.time(),
        "kind": event.get("kind"),
        "status": event.get("status"),
        "error_code": event.get("error_code"),
        "route": event.get("route"),
        "model": event.get("model"),
        "features": event.get("features") if isinstance(event.get("features"), dict) else {},
        "note": (event.get("note") or "")[:200],
    }
    with _LOCK:
        _RING.append(row)


def summary(*, hours: float = 24.0) -> dict[str, Any]:
    """Aggregate the ring over the trailing window."""

    cutoff = time.time() - max(0.1, hours) * 3600
    with _LOCK:
        rows = [row for row in _RING if row["ts"] >= cutoff]

    by_kind = Counter(row.get("kind") or "?" for row in rows)
    by_status = Counter(row.get("status") or "?" for row in rows)
    errors = [row for row in rows if row.get("status") == "error"]
    return {
        "hours": hours,
        "total": len(rows),
        "by_kind": dict(by_kind),
        "by_status": dict(by_status),
        "error_count": len(errors),
        "recent_errors": errors[-20:],
    }
