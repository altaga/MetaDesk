"""Verify harness — project checks on the board, optional flaky-rate repeats."""

from __future__ import annotations

import json

from ..edge.cli import run_command, step_out
from ..edge.files import fs_root, resolve_path

VERIFY_REL = ".desk/verify.json"
MAX_REPEATS = 50


def load_verify_spec() -> dict:
    path = resolve_path(VERIFY_REL)
    if not path.is_file():
        return {"commands": [], "repeats": 1}
    try:
        data = json.loads(path.read_text(encoding="utf-8"))
    except (OSError, json.JSONDecodeError):
        return {"commands": [], "repeats": 1, "error": "invalid verify.json"}
    commands = data.get("commands") or []
    if isinstance(commands, str):
        commands = [commands]
    repeats = int(data.get("repeats") or 1)
    return {"commands": [str(c) for c in commands if str(c).strip()], "repeats": max(1, min(repeats, MAX_REPEATS))}


def write_default_verify(commands: list[str] | None = None) -> None:
    path = resolve_path(VERIFY_REL)
    path.parent.mkdir(parents=True, exist_ok=True)
    body = {"commands": commands or ["python -c \"print('verify-ok')\""], "repeats": 1}
    path.write_text(json.dumps(body, indent=2) + "\n", encoding="utf-8")


def run_verify(*, commands: list[str] | None = None, repeats: int | None = None, secrets: dict | None = None) -> dict:
    """Run the verify commands, optionally repeated to surface flakiness."""

    spec = load_verify_spec()
    cmds = commands if commands is not None else spec["commands"]
    times = repeats if repeats is not None else int(spec.get("repeats") or 1)
    times = max(1, min(int(times), MAX_REPEATS))
    if not cmds:
        return {
            "ok": False,
            "error": f"No verify commands. Create {VERIFY_REL} with {{\"commands\": [...]}}.",
            "runs": [],
            "pass_count": 0,
            "fail_count": 0,
            "pass_rate": 0.0,
            "cwd": str(fs_root()),
        }

    runs: list[dict] = []
    passes = 0
    for index in range(times):
        step_ok = True
        steps = []
        for cmd in cmds:
            row = run_command(cmd, secrets=secrets or {})
            steps.append(step_out(row))
            if row.get("exit_code") != 0 or row.get("timed_out"):
                step_ok = False
        runs.append({"n": index + 1, "ok": step_ok, "steps": steps})
        if step_ok:
            passes += 1

    fails = times - passes
    return {
        "ok": fails == 0,
        "commands": cmds,
        "repeats": times,
        "pass_count": passes,
        "fail_count": fails,
        "pass_rate": round(passes / times, 4) if times else 0.0,
        "runs": runs,
        "cwd": str(fs_root()),
    }
