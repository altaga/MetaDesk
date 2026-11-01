"""One shell command on the board, run inside the desk file root.

Secrets exported for a command are injected into the environment and scrubbed
from the captured output, so a vault value never leaks into a log or a reply.
"""

from __future__ import annotations

import os
import subprocess

from ..vault.redact import redact
from .files import fs_root

MAX_OUT = 20_000
DEFAULT_TIMEOUT_S = 45.0


def _timeout_for(command: str, default: float) -> float:
    """Installers and scaffolds need far more time than an interactive call."""

    lowered = (command or "").lower()
    if any(
        token in lowered
        for token in ("npm install", "npm i ", "npm ci", "npm create", "npx create-", "pip install", "--prefix")
    ) or (lowered.strip().startswith("npm") and " install" in f" {lowered}"):
        return max(default, 600.0)
    if "npm run" in lowered or lowered.strip().startswith("nohup"):
        return max(default, 90.0)
    return default


def _with_nvm_path(env: dict[str, str]) -> dict[str, str]:
    """Prefer nvm's newest node/npm when the login profile was not sourced."""

    home = env.get("HOME") or os.path.expanduser("~")
    nvm_bin = os.path.join(home, ".nvm", "versions", "node")
    if not os.path.isdir(nvm_bin):
        return env
    versions = sorted((entry for entry in os.listdir(nvm_bin) if entry.startswith("v")), reverse=True)
    if not versions:
        return env
    bin_dir = os.path.join(nvm_bin, versions[0], "bin")
    if not os.path.isdir(bin_dir):
        return env
    path = env.get("PATH") or ""
    if bin_dir not in path.split(os.pathsep):
        env = {**env, "PATH": f"{bin_dir}{os.pathsep}{path}", "NVM_DIR": os.path.join(home, ".nvm")}
    return env


def run_command(command: str, timeout_s: float = DEFAULT_TIMEOUT_S, secrets: dict[str, str] | None = None) -> dict:
    """Run ``command`` in the desk root and return a redacted result row."""

    timeout_s = _timeout_for(command, timeout_s)
    root = fs_root()
    hidden = list((secrets or {}).values())
    env = _with_nvm_path(os.environ.copy())
    env.update(secrets or {})
    try:
        proc = subprocess.run(  # noqa: S602 - intentional operator-facing shell tool
            command,
            shell=True,
            capture_output=True,
            text=True,
            timeout=timeout_s,
            cwd=str(root),
            env=env,
        )
    except subprocess.TimeoutExpired as exc:
        stdout = exc.stdout if isinstance(exc.stdout, str) else ""
        return _pack(command, root, None, stdout, "Timed out", True, hidden)
    return _pack(command, root, proc.returncode, proc.stdout or "", proc.stderr or "", False, hidden)


def _pack(
    command: str,
    root,
    code: int | None,
    stdout: str,
    stderr: str,
    timed_out: bool,
    hidden: list[str],
) -> dict:
    return {
        "command": redact(command, hidden),
        "cwd": str(root),
        "exit_code": code,
        "stdout": redact(stdout, hidden)[-MAX_OUT:],
        "stderr": redact(stderr, hidden)[-MAX_OUT:],
        "timed_out": timed_out,
    }


def step_out(row: dict) -> dict:
    """Trim a command row into the compact step shape jobs persist."""

    return {
        "command": row.get("command"),
        "exit_code": row.get("exit_code"),
        "stdout": (row.get("stdout") or "")[-2000:],
        "stderr": (row.get("stderr") or "")[-2000:],
        "timed_out": bool(row.get("timed_out")),
    }
