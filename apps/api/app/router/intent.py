"""Cheap keyword and length heuristics for picking a tier."""

from __future__ import annotations

SHORT_MESSAGE_CHARS = 220
LONG_MESSAGE_CHARS = 1500

#: Requests that clearly warrant the heaviest reasoning tier.
_HEAVY_KEYWORDS = (
    "architecture",
    "refactor",
    "debug hard",
    "long plan",
    "system design",
    "migration plan",
    "postmortem",
    "root cause",
)

#: Lightweight language work that the local model handles well.
_LIGHT_KEYWORDS = (
    "translate",
    "rewrite",
    "reformat",
    "format this",
    "fix grammar",
    "capitalize",
    "summarize this line",
)

_GREETINGS = (
    "hello",
    "hi",
    "hey",
    "good morning",
    "good evening",
    "thanks",
    "thank you",
)


def decide_tier(text: str) -> tuple[str, str]:
    """Return ``(tier, reason)`` for a raw user message."""

    stripped = (text or "").strip()
    lowered = stripped.lower()

    if len(stripped) > LONG_MESSAGE_CHARS:
        return "heavy", "long_input_heavy"

    for keyword in _HEAVY_KEYWORDS:
        if keyword in lowered:
            return "heavy", f"keyword:{keyword}"

    if any(lowered.startswith(greeting) or lowered == greeting for greeting in _GREETINGS):
        return "local", "greeting_local"

    if len(stripped) < SHORT_MESSAGE_CHARS:
        return "local", "short_message_local"

    for keyword in _LIGHT_KEYWORDS:
        if keyword in lowered:
            return "local", f"keyword:{keyword}"

    return "fast", "default_fast"
