"""Local setup for an unpaired board, driven by the desk's /pair wizard.

While the board has no credentials, the agent answers ``/setup`` on the USB
gadget link (``192.168.55.1``) and nowhere else. The desk's wizard runs in the
operator's browser and talks to it directly:

1. **Discover** — ``GET /setup`` says whether the board is unpaired and how it is
   called (a factory name such as ``Jetson#A3F`` until the operator names it).
2. **Setup** — ``POST /setup`` stores the name, a board password (hashed) and the
   Wi-Fi the operator typed, then the board asks the cloud for its own pairing
   code and starts polling.
3. **Pair ID** — the wizard shows that code and the operator confirms it in the
   desk. On the board's next poll it receives its device token, stores it, and
   this server shuts down. A paired board serves nothing: it only dials out.
"""

from __future__ import annotations

import hashlib
import json
import logging
import secrets
import socket
import threading
import time
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer
from typing import Any

import httpx

from . import credentials
from .config import settings

log = logging.getLogger("metadesk.setup")

POLL_SECONDS = 2.0


def _hostname() -> str:
    try:
        return socket.gethostname() or "jetson"
    except OSError:
        return "jetson"


class BoardFile:
    """The unpaired board's local profile: factory tag, name, password hash, Wi-Fi."""

    def __init__(self) -> None:
        self.path = settings.state_path / "board.json"
        self._lock = threading.Lock()

    def load(self) -> dict[str, Any]:
        try:
            data = json.loads(self.path.read_text(encoding="utf-8"))
            return data if isinstance(data, dict) else {}
        except (OSError, ValueError):
            return {}

    def save(self, data: dict[str, Any]) -> None:
        with self._lock:
            self.path.write_text(json.dumps(data, indent=2) + "\n", encoding="utf-8")
            credentials._restrict(self.path)  # noqa: SLF001 - same owner-only rule as the token

    def factory_tag(self) -> str:
        """A stable 3-hex tag so an unnamed board shows up as ``Jetson#A3F``."""

        data = self.load()
        tag = str(data.get("factory_id") or "")
        if len(tag) == 3 and all(c in "0123456789ABCDEF" for c in tag):
            return tag
        tag = f"{secrets.randbits(12):03X}"
        data["factory_id"] = tag
        self.save(data)
        return tag

    def set_profile(self, name: str, password: str, wifi_ssid: str) -> None:
        salt = secrets.token_bytes(16)
        digest = hashlib.scrypt(password.encode(), salt=salt, n=2**14, r=8, p=1)
        data = self.load()
        data["name"] = name
        data["password_hash"] = f"scrypt${salt.hex()}${digest.hex()}"
        # Stored so the operator sees what they asked for. Joining the network is not
        # automated yet: the board keeps using the link it already has.
        data["wifi"] = {"ssid": wifi_ssid, "applied": False}
        self.save(data)


class Pairing:
    """Board-initiated pairing: ask the cloud for a code, then poll until it is confirmed."""

    def __init__(self, on_paired) -> None:
        self._on_paired = on_paired
        self._lock = threading.Lock()
        self.status = "idle"
        self.code: str | None = None
        self.expires_at = 0.0
        self.error: str | None = None

    def snapshot(self) -> dict[str, Any]:
        with self._lock:
            live = self.code and self.expires_at > time.time()
            return {
                "pair_status": self.status,
                "code": self.code if live else None,
                "expires_in": max(0, int(self.expires_at - time.time())) if live else None,
                "error": self.error,
            }

    def start_or_resume(self, name: str) -> None:
        with self._lock:
            if self.status == "paired" or (self.code and self.expires_at > time.time()):
                return
        response = httpx.post(
            f"{settings.cloud_url.rstrip('/')}/v1/pair/start",
            json={"name": name, "hostname": _hostname()},
            timeout=20.0,
        )
        response.raise_for_status()
        data = response.json()
        code, token = str(data.get("code") or ""), str(data.get("poll_token") or "")
        if not code or not token:
            raise RuntimeError("The cloud did not return a pairing code.")
        ttl = int(data.get("expires_in") or 600)
        with self._lock:
            self.status, self.code, self.error = "pending", code, None
            self.expires_at = time.time() + ttl
        threading.Thread(target=self._poll, args=(token, ttl), daemon=True).start()

    def _poll(self, token: str, ttl: int) -> None:
        deadline = time.time() + max(30, ttl)
        url = f"{settings.cloud_url.rstrip('/')}/v1/pair/poll"
        with httpx.Client(timeout=20.0) as client:
            while time.time() < deadline:
                try:
                    response = client.post(url, json={"poll_token": token})
                except httpx.HTTPError:
                    time.sleep(POLL_SECONDS)
                    continue
                if response.status_code == 410:
                    break
                if response.status_code >= 400:
                    time.sleep(POLL_SECONDS)
                    continue
                body = response.json()
                if body.get("status") == "paired":
                    credentials.save(str(body["device_id"]), str(body["device_token"]))
                    with self._lock:
                        self.status, self.code = "paired", None
                    log.info("paired from the desk's /pair wizard")
                    self._on_paired()
                    return
                time.sleep(POLL_SECONDS)
        with self._lock:
            self.status, self.code, self.error = "expired", None, "pair_code_expired"


class SetupServer:
    """Serve ``/setup`` on each configured host until the board is paired."""

    def __init__(self) -> None:
        self.paired = threading.Event()
        self.board = BoardFile()
        # Give the wizard a moment to read "paired" before the server goes away.
        self.pairing = Pairing(on_paired=lambda: threading.Timer(4.0, self.paired.set).start())
        self._servers: list[ThreadingHTTPServer] = []
        self._stop = threading.Event()

    def start(self) -> None:
        self.board.factory_tag()
        for host in settings.setup_host_list:
            threading.Thread(target=self._serve_host, args=(host,), daemon=True).start()

    def _serve_host(self, host: str) -> None:
        # The USB gadget address only exists while the cable is plugged in, so
        # keep retrying the bind instead of giving up.
        while not self._stop.is_set():
            try:
                server = ThreadingHTTPServer((host, settings.setup_port), self._handler())
            except OSError as exc:
                log.info("setup not on %s:%s yet (%s); retrying", host, settings.setup_port, exc)
                self._stop.wait(10)
                continue
            self._servers.append(server)
            log.info("setup ready on http://%s:%s/setup", host, settings.setup_port)
            server.serve_forever(poll_interval=0.5)
            return

    def stop(self) -> None:
        self._stop.set()
        for server in self._servers:
            server.shutdown()
            server.server_close()

    def status(self, prefer_custom: bool = False) -> dict[str, Any]:
        data = self.board.load()
        tag = self.board.factory_tag()
        paired = self.paired.is_set() or self.pairing.status == "paired"
        custom = str(data.get("name") or "").strip()
        return {
            "ok": True,
            "hostname": _hostname(),
            "board_emu": settings.board_emu,
            "factory_id": tag,
            "name": custom if custom and (paired or prefer_custom) else f"Jetson#{tag}",
            "has_password": bool(data.get("password_hash")),
            "wifi": data.get("wifi"),
            "paired": paired,
            **self.pairing.snapshot(),
        }

    def _handler(self):
        owner = self

        class Handler(BaseHTTPRequestHandler):
            server_version = "MetaDeskSetup"

            def log_message(self, fmt: str, *args) -> None:  # quiet; the journal has our own lines
                return

            def _cors(self) -> None:
                origin = self.headers.get("Origin") or ""
                if origin in settings.setup_origin_list:
                    self.send_header("Access-Control-Allow-Origin", origin)
                    self.send_header("Vary", "Origin")
                    self.send_header("Access-Control-Allow-Methods", "GET, POST, OPTIONS")
                    self.send_header("Access-Control-Allow-Headers", "Content-Type")
                    # Chrome's Private Network Access: let the desk page reach this board.
                    self.send_header("Access-Control-Allow-Private-Network", "true")

            def _json(self, status: int, payload: dict) -> None:
                body = json.dumps(payload).encode()
                self.send_response(status)
                self._cors()
                self.send_header("Content-Type", "application/json")
                self.send_header("Content-Length", str(len(body)))
                self.send_header("Cache-Control", "no-store")
                self.end_headers()
                self.wfile.write(body)

            def do_OPTIONS(self) -> None:  # noqa: N802 - stdlib naming
                self.send_response(204)
                self._cors()
                self.send_header("Content-Length", "0")
                self.end_headers()

            def do_GET(self) -> None:  # noqa: N802 - stdlib naming
                if self.path.split("?")[0] == "/setup":
                    self._json(200, owner.status())
                    return
                self._json(404, {"detail": {"error": "not_found"}})

            def do_POST(self) -> None:  # noqa: N802 - stdlib naming
                if self.path.split("?")[0] != "/setup":
                    self._json(404, {"detail": {"error": "not_found"}})
                    return
                if owner.paired.is_set():
                    self._json(409, {"detail": {"error": "board_already_paired"}})
                    return
                try:
                    length = min(int(self.headers.get("Content-Length") or 0), 4096)
                    body = json.loads(self.rfile.read(length) or b"{}")
                except (ValueError, json.JSONDecodeError):
                    body = {}
                name = " ".join(str(body.get("name") or "").split())[:40]
                password = str(body.get("password") or "")
                ssid = str(body.get("wifi_ssid") or "").strip()[:64]
                if not name:
                    self._json(400, {"detail": {"error": "Give the board a name."}})
                    return
                if name.lower() == "nova":
                    self._json(400, {"detail": {"error": "Nova is the desk guide's name; pick another one."}})
                    return
                if len(password) < 4:
                    self._json(400, {"detail": {"error": "The board password needs at least 4 characters."}})
                    return
                if not ssid:
                    self._json(400, {"detail": {"error": "Enter the Wi-Fi name."}})
                    return
                owner.board.set_profile(name, password, ssid)
                try:
                    owner.pairing.start_or_resume(name)
                except (httpx.HTTPError, RuntimeError):
                    self._json(502, {"detail": {"error": "The board could not reach MetaDesk cloud. Check its network."}})
                    return
                self._json(200, owner.status(prefer_custom=True))

        return Handler
