"""An expert is a single profile, written as markdown the model can read.

A brain is deliberately not a notebook. It carries one angle and one method,
so the chat can drop the right expertise into the prompt without drowning it
in stray notes. Pasted text that already looks like an expert file is kept
verbatim; anything else is wrapped into the standard shape.
"""

from __future__ import annotations

import re

from ..markdown import slugify, yaml_scalar

_ANGLE = re.compile(r"## Angle\s+([\s\S]*?)(?:\n## |\Z)")
_METHOD = re.compile(r"## Method\s+([\s\S]*?)(?:\n## |\Z)")

#: The on-screen guide. Expert profiles speak through it rather than replacing it.
GUIDE = "Nova"


def is_expert_file(text: str) -> bool:
    """True when the text already carries the expert front matter."""

    head = (text or "").lstrip()[:500]
    return head.startswith("---") and "kind: expert" in head


def structure_profile(name: str, angle: str, method: str) -> str:
    """Wrap an angle and a method into a stable expert markdown file."""

    clean = (name or "").strip() or "Expert"
    angle_text = (angle or "").strip() or "Bring this expert's judgment to the current conversation."
    method_text = (
        (method or "").strip()
        or "Say what you would do, in order, and stop where this profile is silent."
    )
    return (
        "---\n"
        "kind: expert\n"
        f"name: {yaml_scalar(clean)}\n"
        "---\n\n"
        f"# {clean}\n\n"
        "## Role\n"
        f"{clean} is an expert profile that a conversation can call in. It is not a note store.\n\n"
        "## Angle\n"
        f"{angle_text}\n\n"
        "## Method\n"
        f"{method_text}\n\n"
        "## Use\n"
        f"When the operator writes @{clean}, answer as {GUIDE} from this angle and follow this "
        "method. Name the profile out loud. Do not invent a different specialty.\n"
    ).strip() + "\n"


def profile_markdown(name: str, angle: str, method: str, profile: str = "") -> str:
    """Build the markdown for a brain, honoring a pasted expert file."""

    pasted = (profile or "").strip()
    if is_expert_file(pasted):
        return pasted if pasted.endswith("\n") else pasted + "\n"
    extra = pasted if pasted and not (method or "").strip() else method
    return structure_profile(name, angle, extra)


def profile_filename(name: str) -> str:
    """The path this profile would live at inside the desk workspace."""

    return f"experts/{slugify(name)}.md"


def section(markdown: str, heading: str) -> str:
    """Pull one named section out of a profile."""

    pattern = _ANGLE if heading == "Angle" else _METHOD
    found = pattern.search(markdown or "")
    return (found.group(1) if found else "").strip()


def called_names(text: str, names: list[str]) -> list[str]:
    """Names the operator summoned with ``@Name``. Longer names win."""

    remaining = (text or "").lower()
    found: list[str] = []
    by_lower = {name.lower(): name for name in names}
    for name in sorted(by_lower, key=len, reverse=True):
        needle = f"@{name}"
        if needle in remaining:
            found.append(by_lower[name])
            remaining = remaining.replace(needle, " ")
    return found


def profiles_prompt(names: list[str], called: list[tuple[str, str]]) -> str:
    """``called`` is ``(filename, markdown)`` for the profiles named this turn."""

    if not names:
        return ""
    catalog = ", ".join(f"@{name}" for name in names)
    lines = [
        "Expert profiles. Each one is an agent the conversation can consult for an angle or a way of working.",
        f"Available: {catalog}.",
        f"The operator calls one by writing @Name in the message. Until a profile is called, answer as {GUIDE} and do not adopt an expert.",
    ]
    if not called:
        return "\n".join(lines)
    lines.append(
        "The operator called these profiles for this turn. Answer from each profile's Angle and "
        "Method, and name the profile."
    )
    for filename, markdown in called:
        lines.append(f"\n### {filename}\n```markdown\n{markdown}\n```")
    return "\n".join(lines)
