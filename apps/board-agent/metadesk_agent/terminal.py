"""Interactive shells bridged onto the relay's terminal frames.

The board is Linux, so sessions run under a real pty: `term_open` spawns a
login shell, `term_in` writes keystrokes, `term_resize` updates the window, and
output streams back as base64 `term_out` frames until `term_exit`.
"""

from __future__ import annotations

import asyncio
import base64
import logging
import os
import pwd
from typing import Awaitable, Callable

from . import protocol
from .config import settings

log = logging.getLogger("metadesk.agent")

try:  # Unix only; the board always is, but the agent stays importable elsewhere.
    import fcntl
    import pty
    import struct
    import termios

    _PTY_AVAILABLE = True
except ImportError:  # pragma: no cover - Windows development machines
    _PTY_AVAILABLE = False

_READ_BYTES = 65536

Send = Callable[[dict], Awaitable[None]]


class _Session:
    """One shell process and the pty master it is attached to."""

    def __init__(self, sid: str, pid: int, fd: int, task: asyncio.Task) -> None:
        self.sid = sid
        self.pid = pid
        self.fd = fd
        self.task = task

    def kill(self) -> None:
        try:
            os.killpg(os.getpgid(self.pid), 9)
        except OSError:
            pass
        try:
            os.close(self.fd)
        except OSError:
            pass


class TerminalManager:
    """Owns the live shells for one agent connection."""

    def __init__(self, send: Send) -> None:
        self._send = send
        self._sessions: dict[str, _Session] = {}

    async def open(self, sid: str, cols: int, rows: int) -> None:
        if not _PTY_AVAILABLE:
            await self._send(protocol.term_exit(sid, None))
            return
        if sid in self._sessions:
            return
        master_fd, pid = self._spawn(cols, rows)
        task = asyncio.create_task(self._pump(sid, master_fd))
        self._sessions[sid] = _Session(sid, pid, master_fd, task)

    def write(self, sid: str, data: str) -> None:
        session = self._sessions.get(sid)
        if session is None:
            return
        try:
            os.write(session.fd, data.encode("utf-8"))
        except OSError:
            pass

    def resize(self, sid: str, cols: int, rows: int) -> None:
        session = self._sessions.get(sid)
        if session is None or not _PTY_AVAILABLE:
            return
        try:
            fcntl.ioctl(session.fd, termios.TIOCSWINSZ, struct.pack("HHHH", rows, cols, 0, 0))
        except OSError:
            pass

    def close(self, sid: str) -> None:
        session = self._sessions.pop(sid, None)
        if session is None:
            return
        session.kill()
        session.task.cancel()

    def close_all(self) -> None:
        for sid in list(self._sessions):
            self.close(sid)

    def _spawn(self, cols: int, rows: int) -> tuple[int, int]:
        """Fork a shell on a fresh pty; returns ``(master_fd, pid)``."""

        master_fd, slave_fd = pty.openpty()
        _set_winsize(slave_fd, cols, rows)
        pid = os.fork()
        if pid == 0:  # pragma: no cover - runs in the child process
            os.close(master_fd)
            os.setsid()
            fcntl.ioctl(slave_fd, termios.TIOCSCTTY, 0)
            for target in (0, 1, 2):
                os.dup2(slave_fd, target)
            if slave_fd > 2:
                os.close(slave_fd)
            # A systemd service has no TERM; without it clear, less, nano and tput fail.
            os.environ["TERM"] = "xterm-256color"
            os.environ.setdefault("COLORTERM", "truecolor")
            shell = settings.terminal_shell or os.environ.get("SHELL") or "/bin/bash"
            try:
                # The agent runs from its own checkout; a shell should open at $HOME.
                os.chdir(_home_dir())
            except OSError:
                pass
            try:
                os.execv(shell, [shell, "-l"])
            except OSError:
                os._exit(127)
        os.close(slave_fd)
        return master_fd, pid

    async def _pump(self, sid: str, fd: int) -> None:
        """Stream pty output until the shell exits or the socket closes."""

        loop = asyncio.get_running_loop()
        try:
            while True:
                try:
                    data = await loop.run_in_executor(None, os.read, fd, _READ_BYTES)
                except OSError:
                    break
                if not data:
                    break
                await self._send(protocol.term_out(sid, base64.b64encode(data).decode("ascii")))
        finally:
            session = self._sessions.pop(sid, None)
            if session is not None:
                await self._send(protocol.term_exit(sid, _reap(session.pid)))
                session.kill()


def _set_winsize(fd: int, cols: int, rows: int) -> None:
    try:
        fcntl.ioctl(fd, termios.TIOCSWINSZ, struct.pack("HHHH", rows, cols, 0, 0))
    except OSError:
        pass


def _reap(pid: int) -> int | None:
    """Best-effort exit code for a shell that just closed."""

    try:
        _, status = os.waitpid(pid, os.WNOHANG)
    except OSError:
        return None
    if status == 0:
        return None
    return os.waitstatus_to_exitcode(status) if hasattr(os, "waitstatus_to_exitcode") else None


def _home_dir() -> str:
    """The login user's home, even when the service environment has no $HOME."""

    try:
        return pwd.getpwuid(os.getuid()).pw_dir
    except KeyError:
        return os.path.expanduser("~")
