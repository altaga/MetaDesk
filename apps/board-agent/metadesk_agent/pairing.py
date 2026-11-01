"""Pairing handshake with the cloud.

The board asks the cloud for a short code, shows it to the operator, then polls
until a signed-in operator claims it. The device token only ever arrives on that
poll response, so nothing sensitive is exposed before a human approves.
"""

from __future__ import annotations

import asyncio
import socket
from dataclasses import dataclass

import httpx

from . import credentials
from .config import settings

POLL_INTERVAL_SECONDS = 2.0


@dataclass(frozen=True)
class PairStart:
    code: str
    poll_token: str
    expires_in: int


def hostname() -> str:
    """Best-effort hostname shown to the operator while pairing."""

    try:
        return socket.gethostname() or "board"
    except OSError:
        return "board"


async def start(client: httpx.AsyncClient) -> PairStart:
    """Ask the cloud for a pairing code and its poll token."""

    response = await client.post(
        f"{settings.cloud_url.rstrip('/')}/v1/pair/start",
        json={"name": settings.board_name, "hostname": hostname()},
    )
    response.raise_for_status()
    data = response.json()
    return PairStart(
        code=str(data["code"]),
        poll_token=str(data["poll_token"]),
        expires_in=int(data.get("expires_in", 600)),
    )


async def poll(client: httpx.AsyncClient, poll_token: str) -> dict:
    """One poll attempt; returns ``{"status": "pending"}`` until claimed."""

    response = await client.post(
        f"{settings.cloud_url.rstrip('/')}/v1/pair/poll",
        json={"poll_token": poll_token},
    )
    if response.status_code == 404:
        raise PairingError("The pairing request expired or was rejected.")
    if response.status_code == 410:
        raise PairingError("The pairing code expired before it was claimed.")
    response.raise_for_status()
    return response.json()


async def wait_for_claim(client: httpx.AsyncClient, start_info: PairStart, on_wait) -> credentials.Credentials:
    """Poll until the operator claims the code, then persist the device token."""

    deadline = asyncio.get_running_loop().time() + start_info.expires_in
    while True:
        if asyncio.get_running_loop().time() >= deadline:
            raise PairingError("The pairing code expired before it was claimed.")
        payload = await poll(client, start_info.poll_token)
        if payload.get("status") == "paired":
            return credentials.save(str(payload["device_id"]), str(payload["device_token"]))
        on_wait()
        await asyncio.sleep(POLL_INTERVAL_SECONDS)


class PairingError(RuntimeError):
    """Raised when pairing cannot complete."""
