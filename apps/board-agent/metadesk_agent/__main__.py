"""Command line entrypoint: pair the board, then run the agent.

    python -m metadesk_agent pair     # show a code, wait for the operator
    python -m metadesk_agent run      # dial out and serve frames (default); unpaired → /setup for the desk wizard
    python -m metadesk_agent status   # print the stored device id
    python -m metadesk_agent unpair   # forget the stored identity
"""

from __future__ import annotations

import argparse
import asyncio
import sys

import httpx

from . import credentials, pairing
from .agent import configure_logging, serve
from .config import APP_NAME, APP_VERSION, settings
from .setup_server import SetupServer


def _build_parser() -> argparse.ArgumentParser:
    parser = argparse.ArgumentParser(prog="metadesk_agent", description=f"{APP_NAME} {APP_VERSION}")
    parser.add_argument("command", nargs="?", default="run", choices=("run", "pair", "status", "unpair"))
    return parser


async def _pair() -> int:
    async with httpx.AsyncClient(timeout=30.0) as client:
        start = await pairing.start(client)
        print(f"Board: {settings.board_name}")
        print(f"Pairing code: {start.code}")
        print("Claim it from the desk to finish pairing. Waiting...")
        creds = await pairing.wait_for_claim(client, start, lambda: print(".", end="", flush=True))
        print()
        print(f"Paired. device_id={creds.device_id} stored at {settings.credentials_path}")
    return 0


def _status() -> int:
    creds = credentials.load()
    if creds is None:
        print("Not paired. Run: python -m metadesk_agent pair")
        return 1
    print(f"device_id={creds.device_id}")
    print(f"cloud_url={creds.cloud_url}")
    print(f"state={settings.credentials_path}")
    return 0


def _unpair() -> int:
    credentials.clear()
    print("Credentials cleared. The board will need to pair again.")
    return 0


def _await_setup() -> credentials.Credentials | None:
    """Unpaired: answer /setup on the USB link until the desk's /pair wizard pairs this board."""

    server = SetupServer()
    server.start()
    hosts = ", ".join(f"http://{host}:{settings.setup_port}" for host in settings.setup_host_list)
    print(f"Not paired yet. In the desk, open Fleet → Set up a board (this board answers on {hosts}/setup).", flush=True)
    try:
        server.paired.wait()
    except KeyboardInterrupt:
        server.stop()
        return None
    server.stop()
    return credentials.load()


def _needs_cloud_url() -> bool:
    """The Worker address is deployment config, so pairing stops without it."""

    if settings.cloud_url.strip():
        return False
    print("METADESK_CLOUD_URL is not set. Point it at your Worker in .env, then try again.", file=sys.stderr)
    return True


def main(argv: list[str] | None = None) -> int:
    args = _build_parser().parse_args(argv)
    configure_logging()

    if args.command == "pair":
        if _needs_cloud_url():
            return 2
        return asyncio.run(_pair())
    if args.command == "status":
        return _status()
    if args.command == "unpair":
        return _unpair()

    creds = credentials.load()
    if creds is None:
        if _needs_cloud_url():
            return 2
        creds = _await_setup()
        if creds is None:
            return 1
    try:
        asyncio.run(serve(creds))
    except KeyboardInterrupt:
        print("Agent stopped.")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
