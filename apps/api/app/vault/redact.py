"""Mask secret values in anything the desk is about to show or store."""

from __future__ import annotations

_MASK = "••••"

#: Values shorter than this are too generic to mask without wrecking the text.
_MIN_MASKABLE = 4


def redact(text: str, secrets: list[str]) -> str:
    """Replace every occurrence of a secret value with a mask."""

    if not text or not secrets:
        return text
    cleaned = text
    for secret in sorted({item for item in secrets if item}, key=len, reverse=True):
        cleaned = cleaned.replace(secret, _MASK)
    return cleaned


class StreamRedactor:
    """Mask secrets across a stream, where a value can arrive split in two.

    Chunks are buffered so that a partial secret at the tail of one chunk is
    never emitted before the rest of it shows up in the next.
    """

    def __init__(self, secrets: list[str]) -> None:
        self._secrets = sorted({item for item in secrets if len(item) >= _MIN_MASKABLE}, key=len, reverse=True)
        self._hold = ""

    def feed(self, text: str) -> str:
        """Return the safe prefix of ``text``, holding back a partial match."""

        combined = redact(self._hold + text, self._secrets)
        hold = _prefix_hold(combined, self._secrets)
        self._hold = combined[len(combined) - hold :] if hold else ""
        return combined[: len(combined) - hold] if hold else combined

    def flush(self) -> str:
        """Release whatever is still buffered, masked first."""

        out = redact(self._hold, self._secrets)
        self._hold = ""
        return out


def _prefix_hold(text: str, secrets: list[str]) -> int:
    """Length of the longest secret prefix the text currently ends with."""

    hold = 0
    for secret in secrets:
        limit = min(len(secret) - 1, len(text))
        for size in range(limit, 0, -1):
            if text.endswith(secret[:size]):
                hold = max(hold, size)
                break
    return hold
