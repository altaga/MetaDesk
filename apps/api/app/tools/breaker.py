"""A small circuit breaker for flaky external services.

The desk fails soft: once a dependency trips the breaker, calls return a
fallback instead of stalling the turn, and the breaker closes itself again
after a cool-down.
"""

from __future__ import annotations

import threading
import time
from dataclasses import dataclass

DEFAULT_THRESHOLD = 3
DEFAULT_RESET_AFTER_S = 60.0

_LOCK = threading.Lock()


@dataclass
class _BreakerState:
    failures: int = 0
    opened_at: float | None = None
    last_error: str = ""


_STATES: dict[str, _BreakerState] = {}


def _state(name: str) -> _BreakerState:
    with _LOCK:
        if name not in _STATES:
            _STATES[name] = _BreakerState()
        return _STATES[name]


def is_open(name: str, *, reset_after_s: float = DEFAULT_RESET_AFTER_S) -> bool:
    """Whether calls to ``name`` should be skipped right now."""

    state = _state(name)
    with _LOCK:
        if state.opened_at is None:
            return False
        if time.monotonic() - state.opened_at >= reset_after_s:
            state.opened_at = None
            state.failures = 0
            return False
        return True


def record_success(name: str) -> None:
    """Clear the breaker after a good call."""

    state = _state(name)
    with _LOCK:
        state.failures = 0
        state.opened_at = None
        state.last_error = ""


def record_failure(
    name: str,
    error: str,
    *,
    threshold: int = DEFAULT_THRESHOLD,
    reset_after_s: float = DEFAULT_RESET_AFTER_S,
) -> bool:
    """Count a failure and report whether the breaker is open afterwards."""

    state = _state(name)
    with _LOCK:
        state.failures += 1
        state.last_error = (error or "")[:300]
        if state.failures >= threshold:
            state.opened_at = time.monotonic()
            return True
        return state.opened_at is not None


def status(name: str | None = None) -> dict:
    """Snapshot one breaker, or all of them."""

    with _LOCK:
        if name:
            state = _STATES.get(name) or _BreakerState()
            return {
                "name": name,
                "open": state.opened_at is not None,
                "failures": state.failures,
                "last_error": state.last_error,
            }
        return {
            key: {
                "open": value.opened_at is not None,
                "failures": value.failures,
                "last_error": value.last_error,
            }
            for key, value in _STATES.items()
        }


def reset(name: str | None = None) -> None:
    """Forget one breaker, or every breaker."""

    with _LOCK:
        if name:
            _STATES.pop(name, None)
        else:
            _STATES.clear()
