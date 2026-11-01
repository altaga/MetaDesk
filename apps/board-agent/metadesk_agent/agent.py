"""Long-lived agent that keeps the board reachable from the cloud.

The board never accepts inbound connections: this process dials out to the relay
with its device token, then answers the frames the relay pushes down — HTTP
requests against the local API and interactive terminal sessions.
"""

from __future__ import annotations

import asyncio
import json
import logging
import socket

import websockets
from websockets.asyncio.client import ClientConnection

from . import protocol
from .board_client import BoardClient
from .config import APP_NAME, APP_VERSION, settings
from .credentials import Credentials
from .pairing import hostname
from .terminal import TerminalManager

log = logging.getLogger("metadesk.agent")


class Agent:
    """Maintains the relay socket and dispatches its frames."""

    def __init__(self, creds: Credentials) -> None:
        self._creds = creds
        self._ws: ClientConnection | None = None
        self._connected = False
        self._send_lock = asyncio.Lock()
        self._requests: dict[str, asyncio.Task] = {}
        self._board = BoardClient()
        self._terminals = TerminalManager(self._send)

    async def run(self) -> None:
        """Connect, serve frames, and reconnect with backoff until cancelled."""

        delay = 1
        while True:
            self._connected = False
            try:
                await self._session()
            except asyncio.CancelledError:
                await self._board.aclose()
                raise
            except Exception as exc:  # noqa: BLE001 - keep the board dialing forever
                log.warning("relay connection lost: %s", exc)
            # A drop after a healthy session redials at once; backoff is only for
            # repeated failures to connect. Otherwise every drop cost the full
            # backoff and requests sent meanwhile timed out at the relay.
            if self._connected:
                delay = 1
            await asyncio.sleep(delay)
            delay = min(delay * 2, settings.reconnect_max_seconds)

    async def _session(self) -> None:
        headers = {"Authorization": f"Bearer {self._creds.device_token}"}
        async with websockets.connect(
            settings.ws_url,
            additional_headers=headers,
            ping_interval=20,
            ping_timeout=20,
            max_size=None,
        ) as ws:
            self._ws = ws
            self._connected = True
            log.info("connected to %s as %s", settings.ws_url, self._creds.device_id)
            await self._send(protocol.hello(APP_VERSION, hostname(), settings.board_emu))
            beat = asyncio.create_task(self._heartbeat())
            try:
                async for raw in ws:
                    await self._dispatch(raw)
            finally:
                beat.cancel()
                self._ws = None
                self._shutdown_sessions()

    async def _heartbeat(self) -> None:
        while True:
            await asyncio.sleep(settings.heartbeat_seconds)
            try:
                await self._send(protocol.beat())
            except Exception:  # noqa: BLE001 - the reader loop will notice the drop
                return

    async def _dispatch(self, raw: str | bytes) -> None:
        text = raw if isinstance(raw, str) else raw.decode("utf-8")
        try:
            frame = protocol.parse_to_agent(text)
        except ValueError as exc:
            log.warning("dropping unknown frame: %s", exc)
            return

        kind = frame.t
        if kind == "hello_ack":
            log.info("board hello acknowledged")
        elif kind == "beat_ack":
            pass
        elif kind == "req":
            self._requests[frame.id] = asyncio.create_task(self._serve_request(frame))
        elif kind == "cancel":
            task = self._requests.pop(frame.id, None)
            if task is not None:
                task.cancel()
        elif kind == "term_open":
            await self._terminals.open(frame.sid, frame.cols, frame.rows)
        elif kind == "term_in":
            self._terminals.write(frame.sid, frame.data)
        elif kind == "term_resize":
            self._terminals.resize(frame.sid, frame.cols, frame.rows)
        elif kind == "term_close":
            self._terminals.close(frame.sid)

    async def _serve_request(self, frame: protocol.ReqFrame) -> None:
        try:
            await self._board.relay(frame, self._send)
        except asyncio.CancelledError:
            raise
        except Exception as exc:  # noqa: BLE001 - one bad request must not drop the socket
            log.warning("request %s failed: %s", frame.id, exc)
        finally:
            self._requests.pop(frame.id, None)

    async def _send(self, frame: dict) -> None:
        ws = self._ws
        if ws is None:
            return
        async with self._send_lock:
            await ws.send(json.dumps(frame))

    def _shutdown_sessions(self) -> None:
        for task in self._requests.values():
            task.cancel()
        self._requests.clear()
        self._terminals.close_all()


def configure_logging() -> None:
    logging.basicConfig(
        level=getattr(logging, settings.log_level.upper(), logging.INFO),
        format="%(asctime)s %(levelname)s %(name)s %(message)s",
    )


async def serve(creds: Credentials) -> None:
    """Run one agent until the process is stopped."""

    log.info("%s %s starting on %s", APP_NAME, APP_VERSION, socket.gethostname())
    await Agent(creds).run()
