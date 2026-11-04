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
    r">\s*/dev/(?!null\b)",
)

_COMPILED_DESTRUCTIVE = tuple(re.compile(pattern, re.IGNORECASE) for pattern in DESTRUCTIVE_PATTERNS)

#: Robotic arm joint regex: catches commands setting joints
_JOINTS_PATTERN = re.compile(
    r"(?:--joints|JOINTS)\s+([-\d.]+)\s+([-\d.]+)\s+([-\d.]+)\s+([-\d.]+)",
    re.IGNORECASE,
)

#: Hardware limits for 4DOF Robotic Arm
LIMIT_BASE = (0.0, 180.0)
LIMIT_SHOULDER = (0.0, 180.0)
LIMIT_ELBOW = (90.0, 180.0)  # HARD MECHANICAL INTERLOCK
LIMIT_WRIST = (0.0, 180.0)


def is_destructive(command: str) -> bool:
    """Return ``True`` when a command matches the destructive denylist."""
    if not command:
        return False
    return any(pattern.search(command) for pattern in _COMPILED_DESTRUCTIVE)


def hardware_safety_violation(command: str) -> str | None:
    """Check command for hardware safety violations on connected physical peripherals.

    Returns an error message if safety limits are violated, or None if safe.
    """
    if not command:
        return None

    # Robotic arm joint angle safety guard
    match = _JOINTS_PATTERN.search(command)
    if match:
        try:
            base = float(match.group(1))
            shoulder = float(match.group(2))
            elbow = float(match.group(3))
            wrist = float(match.group(4))
        except ValueError:
            return "hardware_safety_violation: Invalid non-numeric joint angles."

        if not (LIMIT_ELBOW[0] <= elbow <= LIMIT_ELBOW[1]):
            return (
                f"hardware_safety_violation: Elbow angle {elbow:.1f}° out of safe range "
                f"[{LIMIT_ELBOW[0]}°, {LIMIT_ELBOW[1]}°]. Refusing command to prevent gear stripping."
            )
        if not (LIMIT_BASE[0] <= base <= LIMIT_BASE[1]):
            return f"hardware_safety_violation: Base angle {base:.1f}° out of range [{LIMIT_BASE[0]}°, {LIMIT_BASE[1]}°]."
        if not (LIMIT_SHOULDER[0] <= shoulder <= LIMIT_SHOULDER[1]):
            return f"hardware_safety_violation: Shoulder angle {shoulder:.1f}° out of range [{LIMIT_SHOULDER[0]}°, {LIMIT_SHOULDER[1]}°]."
        if not (LIMIT_WRIST[0] <= wrist <= LIMIT_WRIST[1]):
            return f"hardware_safety_violation: Wrist angle {wrist:.1f}° out of range [{LIMIT_WRIST[0]}°, {LIMIT_WRIST[1]}°]."

    return None
