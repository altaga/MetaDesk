"""Streaming client for the Meta Model API (OpenAI-compatible)."""

from __future__ import annotations

import json
from typing import AsyncIterator, Sequence

import httpx

from ..config import settings

_TIMEOUT = httpx.Timeout(connect=5.0, read=180.0, write=30.0, pool=5.0)


async def stream_chat(messages: Sequence[dict], model: str) -> AsyncIterator[str]:
    """Yield text chunks from ``/chat/completions`` using SSE parsing.

    Transport or protocol failures propagate to the hybrid router.
    """

    url = settings.meta_base_url.rstrip("/") + "/chat/completions"
    headers = {
        "Authorization": f"Bearer {settings.meta_api_key}",
        "Content-Type": "application/json",
    }
    payload = {"model": model, "messages": list(messages), "stream": True}

    async with httpx.AsyncClient(timeout=_TIMEOUT) as client:
        async with client.stream("POST", url, json=payload, headers=headers) as response:
            response.raise_for_status()
            async for line in response.aiter_lines():
                if not line or not line.startswith("data:"):
                    continue
                data = line[len("data:"):].strip()
                if not data or data == "[DONE]":
                    if data == "[DONE]":
                        break
                    continue
                try:
                    event = json.loads(data)
                except json.JSONDecodeError:
                    continue
                choices = event.get("choices") or []
                if not choices:
                    continue
                delta = choices[0].get("delta") or {}
                content = delta.get("content")
                if content:
                    yield content


async def complete(messages: Sequence[dict], model: str) -> str:
    """Collect a full non-streaming reply by draining the SSE stream."""

    parts: list[str] = []
    async for chunk in stream_chat(messages, model):
        parts.append(chunk)
    return "".join(parts).strip()
