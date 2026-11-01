"""Deploy / rollback recipes on the board — human-owned scripts, Desk orchestrates.

A recipe is a small ``.desk/recipes.json`` file the operator writes; the desk
only runs it, verifies the result, and rolls back when verification fails.
"""

from __future__ import annotations

import json

from ..edge.cli import run_command, step_out
from ..edge.files import resolve_path
from .verify import run_verify

RECIPES_REL = ".desk/recipes.json"


def load_recipes() -> dict:
    path = resolve_path(RECIPES_REL)
    if not path.is_file():
        return {"deploy": [], "rollback": [], "precheck": []}
    try:
        data = json.loads(path.read_text(encoding="utf-8"))
    except (OSError, json.JSONDecodeError):
        return {"deploy": [], "rollback": [], "precheck": [], "error": "invalid recipes.json"}

    def _commands(key: str) -> list[str]:
        raw = data.get(key) or []
        if isinstance(raw, str):
            raw = [raw]
        return [str(c) for c in raw if str(c).strip()]

    return {
        "deploy": _commands("deploy"),
        "rollback": _commands("rollback"),
        "precheck": _commands("precheck"),
        "verify_after_deploy": bool(data.get("verify_after_deploy", True)),
        "rollback_on_verify_fail": bool(data.get("rollback_on_verify_fail", True)),
    }


def write_default_recipes(*, deploy: list[str] | None = None, rollback: list[str] | None = None) -> None:
    path = resolve_path(RECIPES_REL)
    path.parent.mkdir(parents=True, exist_ok=True)
    body = {
        "precheck": [],
        "deploy": deploy or ['python -c "print(\'deploy-ok\')"'],
        "rollback": rollback or ['python -c "print(\'rollback-ok\')"'],
        "verify_after_deploy": True,
        "rollback_on_verify_fail": True,
    }
    path.write_text(json.dumps(body, indent=2) + "\n", encoding="utf-8")


def _run_steps(commands: list[str], *, secrets: dict | None, label: str) -> dict:
    steps = []
    ok = True
    for cmd in commands:
        row = run_command(cmd, secrets=secrets or {})
        steps.append(step_out(row))
        if row.get("exit_code") != 0 or row.get("timed_out"):
            ok = False
            break
    return {"label": label, "ok": ok, "steps": steps}


def run_deploy(*, secrets: dict | None = None, skip_verify: bool = False) -> dict:
    """Run precheck → deploy → verify, rolling back when verify fails."""

    recipes = load_recipes()
    if recipes.get("error"):
        return {"ok": False, "error": recipes["error"], "phases": []}
    if not recipes.get("deploy"):
        return {
            "ok": False,
            "error": f"No deploy recipe. Create {RECIPES_REL} with {{\"deploy\": [...], \"rollback\": [...]}}.",
            "phases": [],
        }

    phases: list[dict] = []
    if recipes.get("precheck"):
        pre = _run_steps(recipes["precheck"], secrets=secrets, label="precheck")
        phases.append(pre)
        if not pre["ok"]:
            return {"ok": False, "error": "precheck failed", "phases": phases, "rolled_back": False}

    deploy = _run_steps(recipes["deploy"], secrets=secrets, label="deploy")
    phases.append(deploy)
    if not deploy["ok"]:
        return {"ok": False, "error": "deploy failed", "phases": phases, "rolled_back": False}

    verify_result = None
    if recipes.get("verify_after_deploy") and not skip_verify:
        verify_result = run_verify(secrets=secrets)
        phases.append({"label": "verify", "ok": bool(verify_result.get("ok")), "verify": verify_result})
        if not verify_result.get("ok") and recipes.get("rollback_on_verify_fail"):
            rollback = _run_steps(recipes.get("rollback") or [], secrets=secrets, label="rollback")
            phases.append(rollback)
            return {
                "ok": False,
                "error": "verify failed after deploy; rollback attempted",
                "phases": phases,
                "rolled_back": bool(rollback.get("ok")),
                "verify": verify_result,
            }

    return {"ok": True, "error": None, "phases": phases, "rolled_back": False, "verify": verify_result}
