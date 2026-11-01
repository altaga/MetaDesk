"""Streaming client for the local Ollama model on the board."""

from __future__ import annotations

import asyncio
import json
import logging
from typing import AsyncIterator, Sequence

import httpx

from ..config import settings

_TIMEOUT = httpx.Timeout(connect=3.0, read=120.0, write=30.0, pool=5.0)

#: Never unload the local model: a cold load costs the operator about a minute.
KEEP_ALIVE = -1

log = logging.getLogger("metadesk.local_llm")


async def warm(model: str, attempts: int = 30, delay: float = 10.0) -> bool:
    """Load the local model and pin it in memory, so no turn waits for a load.

    Runs at API startup. Ollama may still be booting, so it retries for a few
    minutes; failure only means the first turn pays the load instead.
    """

    url = settings.ollama_base_url.rstrip("/") + "/api/generate"
    payload = {"model": model, "keep_alive": KEEP_ALIVE}
    timeout = httpx.Timeout(connect=3.0, read=300.0, write=30.0, pool=5.0)
    for attempt in range(1, attempts + 1):
        try:
            async with httpx.AsyncClient(timeout=timeout) as client:
                response = await client.post(url, json=payload)
                response.raise_for_status()
            log.info("local model %s loaded and pinned", model)
            return True
        except Exception as exc:  # noqa: BLE001 - keep trying until Ollama is up
            log.warning("local model warm-up %d/%d failed: %s", attempt, attempts, exc)
            await asyncio.sleep(delay)
    return False


async def stream_chat(messages: Sequence[dict], model: str) -> AsyncIterator[str]:
    """Yield text chunks from the local chat endpoint.

    Any transport or protocol failure is allowed to propagate: the hybrid
    router turns it into a graceful offline notice.
    """

    url = settings.ollama_base_url.rstrip("/") + "/api/chat"
    payload = {
        "model": model,
        "messages": list(messages),
        "stream": True,
        # Local turns are short; a reasoning pass would cost several times the
        # latency on the board. Models without a thinking mode ignore this.
        "think": False,
        # Loading the model takes about a minute on the board, so it stays
        # resident for good instead of Ollama's 5-minute default.
        "keep_alive": KEEP_ALIVE,
    }

    async with httpx.AsyncClient(timeout=_TIMEOUT) as client:
        async with client.stream("POST", url, json=payload) as response:
            response.raise_for_status()
            async for line in response.aiter_lines():
                if not line:
                    continue
                try:
                    event = json.loads(line)
                except json.JSONDecodeError:
                    continue
                chunk = event.get("message", {}).get("content")
                if chunk:
                    yield chunk
                if event.get("done"):
                    break

