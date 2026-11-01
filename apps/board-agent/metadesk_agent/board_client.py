"""Relay the cloud's HTTP requests onto the board's local API.

Each ``req`` frame becomes one request against ``METADESK_BOARD_URL`` whose
response is streamed back as ``res`` → ``chunk``* → ``end``. Bodies are decoded
from base64 and re-encoded on the way out.
"""

from __future__ import annotations

import base64
import logging
from typing import Awaitable, Callable

import httpx

from . import protocol, token
from .config import settings

log = logging.getLogger("metadesk.agent")

# Hop-by-hop and length headers must not survive the bridge: httpx already
# decompresses the body, and the relay builds its own chunked response.
_DROP_RESPONSE_HEADERS = {
    "connection",
    "keep-alive",
    "transfer-encoding",
    "content-length",
    "content-encoding",
}

Send = Callable[[dict], Awaitable[None]]


class BoardClient:
    """Talks to the local board API on behalf of an operator."""

    def __init__(self) -> None:
        self._client = httpx.AsyncClient(base_url=settings.board_url.rstrip("/"), timeout=None)

    async def aclose(self) -> None:
        await self._client.aclose()

    async def relay(self, frame: protocol.ReqFrame, send: Send) -> None:
        """Forward one request and stream its response back as relay frames."""

        try:
            body = base64.b64decode(frame.body) if frame.body else None
        except (ValueError, TypeError):
            await send(protocol.end(frame.id, "bad_request_body"))
            return

        headers = dict(frame.headers)
        headers["authorization"] = f"Bearer {token.for_operator(frame.user.username)}"
        headers["x-request-id"] = frame.id

        try:
            async with self._client.stream(frame.method, frame.path, content=body, headers=headers) as response:
                await send(protocol.res(frame.id, response.status_code, _response_headers(response)))
                async for piece in response.aiter_bytes(protocol.RESPONSE_CHUNK_BYTES):
                    if piece:
                        await send(protocol.chunk(frame.id, base64.b64encode(piece).decode("ascii")))
        except (httpx.HTTPError, OSError) as exc:
            log.warning("board request failed id=%s path=%s: %s", frame.id, frame.path, exc)
            await send(protocol.end(frame.id, "board_unreachable"))
            return
        await send(protocol.end(frame.id))


def _response_headers(response: httpx.Response) -> dict[str, str]:
    """Response headers worth forwarding, minus the ones the bridge rebuilds."""

    forwarded: dict[str, str] = {}
    for name, value in response.headers.items():
        if name.lower() in _DROP_RESPONSE_HEADERS:
            continue
        forwarded[name] = value
    return forwarded
