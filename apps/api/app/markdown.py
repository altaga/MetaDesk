"""Small helpers for the markdown files the model reads.

Expert profiles and shared memory are stored as markdown with a tiny front
matter block. These helpers keep those files tidy and build stable filenames
for them, so the prompt and the operator UI can agree on the same shape.
"""

from __future__ import annotations

import re

_SLUG_RUN = re.compile(r"[^a-z0-9]+")
_QUOTED = re.compile(r"""^(['"])(.*)\1$""")
_UNSAFE = re.compile(r"[:#{}[\]&*!|>%@`\"'\\]|^\s|\s$")
_KEYWORDS = frozenset({"true", "false", "null", "yes", "no", "~"})


def yaml_scalar(value: str) -> str:
    """Render one value as a safe inline YAML scalar."""

    text = " ".join((value or "").split())
    if not text:
        return '""'
    if text.lower() in _KEYWORDS or _UNSAFE.search(text):
        escaped = text.replace("\\", "\\\\").replace('"', '\\"')
        return f'"{escaped}"'
    return text


def yaml_unquote(value: str) -> str:
    """Undo :func:`yaml_scalar` quoting."""

    text = (value or "").strip()
    quoted = _QUOTED.match(text)
    if quoted:
        return quoted.group(2).replace('\\"', '"').replace("\\\\", "\\")
    return text


def slugify(value: str) -> str:
    """A short, filename-friendly slug."""

    slug = _SLUG_RUN.sub("-", (value or "").strip().lower()).strip("-")
    return slug[:60] or "file"
