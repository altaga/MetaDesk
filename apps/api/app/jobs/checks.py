"""Lint/type/vuln gate — runs whatever the project already declares."""

from __future__ import annotations

import json

from ..edge.cli import run_command, step_out
from ..edge.files import resolve_path

CHECKS_REL = ".desk/checks.json"


def load_checks() -> dict:
    path = resolve_path(CHECKS_REL)
    if not path.is_file():
        return {"commands": []}
    try:
        data = json.loads(path.read_text(encoding="utf-8"))
    except (OSError, json.JSONDecodeError):
        return {"commands": [], "error": "invalid checks.json"}
    commands = data.get("commands") or []
    if isinstance(commands, str):
        commands = [commands]
    return {"commands": [str(c) for c in commands if str(c).strip()]}


def write_default_checks(commands: list[str] | None = None) -> None:
    path = resolve_path(CHECKS_REL)
    path.parent.mkdir(parents=True, exist_ok=True)
    body = {"commands": commands or ['python -c "print(\'checks-ok\')"']}
    path.write_text(json.dumps(body, indent=2) + "\n", encoding="utf-8")


def run_checks(*, secrets: dict | None = None) -> dict:
    """Run each configured gate, stopping at the first failure."""

    spec = load_checks()
    if spec.get("error"):
        return {"ok": False, "error": spec["error"], "steps": []}
    cmds = spec.get("commands") or []
    if not cmds:
        return {
            "ok": False,
            "error": f"No check commands. Create {CHECKS_REL} with {{\"commands\": [...]}}.",
            "steps": [],
        }
    steps = []
    ok = True
    for cmd in cmds:
        row = run_command(cmd, secrets=secrets or {})
        steps.append(step_out(row))
        if row.get("exit_code") != 0 or row.get("timed_out"):
            ok = False
            break
    return {"ok": ok, "commands": cmds, "steps": steps}
