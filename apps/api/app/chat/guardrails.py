"""Safety rules for shell commands issued by the desk agent."""

from __future__ import annotations

import re

#: Patterns that mark a ``run`` command as destructive and require approval.
DESTRUCTIVE_PATTERNS = (
    r"rm\s+-rf",
    r"\bmkfs\b",
    r"\bdd\s+if=",
    r"\bshutdown\b",
    r"\breboot\b",
    r":\(\)\s*\{",
    r"chmod\s+-R\s+777\s+/",
    r">\s*/dev/",
)

_COMPILED = tuple(re.compile(pattern, re.IGNORECASE) for pattern in DESTRUCTIVE_PATTERNS)


def is_destructive(command: str) -> bool:
    """Return ``True`` when a command matches the destructive denylist."""

    if not command:
        return False
    return any(pattern.search(command) for pattern in _COMPILED)
