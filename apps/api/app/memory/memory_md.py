"""Shared memory is a markdown file with a shape the model can rely on.

Every chat on the board reads the same memory files. Each one carries a front
matter block, a ``Fact`` section (the thing to remember) and a ``Use`` section
(how to apply it), so the model never mistakes an instruction for a fact.
"""

from __future__ import annotations

import re
from datetime import datetime, timezone

from ..markdown import slugify, yaml_scalar, yaml_unquote

_FRONT_TITLE = re.compile(r"(?m)^title:\s*(.+)$")
_FACT = re.compile(r"## Fact\s+([\s\S]*?)(?:\n## |\Z)")


def is_memory_file(text: str) -> bool:
    """True when the text already carries the memory front matter."""

    head = (text or "").lstrip()[:500]
    return head.startswith("---") and "kind: memory" in head


def structure_memory(title: str, content: str) -> tuple[str, str]:
    """Return ``(title, markdown)``. An existing memory file is left intact."""

    raw = (content or "").strip()
    if is_memory_file(raw):
        found = _FRONT_TITLE.search(raw)
        name = yaml_unquote(found.group(1)) if found else (title or "").strip()
        return (name or "Memory")[:80], _stable(raw)

    name = ((title or "").strip() or _first_line(raw) or "Memory")[:80]
    when = datetime.now(timezone.utc).date().isoformat()
    markdown = (
        "---\n"
        "kind: memory\n"
        f"title: {yaml_scalar(name)}\n"
        f"updated: {when}\n"
        "scope: device\n"
        "---\n\n"
        f"# {name}\n\n"
        "## Fact\n"
        f"{raw}\n\n"
        "## Use\n"
        "This file is shared by every chat on this board. Treat Fact as the source. "
        "Do not add details that are not written there. If Fact conflicts with a guess, keep Fact.\n"
    )
    return name, _stable(markdown)


def memory_filename(title: str) -> str:
    """The path this memory file would live at inside the desk workspace."""

    return f"memory/{slugify(title)}.md"


def fact_text(markdown: str) -> str:
    """The Fact body, or the whole file when there is no Fact heading."""

    found = _FACT.search(markdown or "")
    return (found.group(1) if found else markdown or "").strip()


def memory_prompt(files: list[tuple[str, str]]) -> str:
    """``files`` is ``(filename, markdown)`` for the shared memory to inject."""

    if not files:
        return ""
    blocks = [f"### {name}\n```markdown\n{body}\n```" for name, body in files]
    lead = (
        "Shared memory files. Read each file's front matter and its Fact section. "
        "The Use section says how to apply the file; it is not an extra fact."
    )
    return lead + "\n\n" + "\n\n".join(blocks)


def _stable(text: str) -> str:
    return text.strip() + "\n"


def _first_line(text: str) -> str:
    line = (text or "").split("\n", 1)[0].strip().lstrip("#").strip()
    return line[:80]
