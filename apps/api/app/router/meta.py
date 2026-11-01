"""Streaming client for the Meta Model API (OpenAI-compatible).

A paired board reaches Muse through the cloud gateway with its device token,
so the Meta key stays in the Worker and every turn is metered there. A board
that is not paired can still use a local ``META_API_KEY`` (development only).
"""

from __future__ import annotations

import json
from typing import AsyncIterator, Sequence

import httpx

from ..cloudlink import cloud_config
from ..config import settings

_TIMEOUT = httpx.Timeout(connect=5.0, read=180.0, write=30.0, pool=5.0)


class CloudCreditSpent(RuntimeError):
    """The account's cloud credit is used up (or its plan is inactive)."""


def _endpoint() -> tuple[str, str] | None:
    """``(chat completions url, bearer token)``, gateway first; None when Muse is out of reach."""

    cloud = cloud_config()
    if cloud:
        base, device_token = cloud
        return f"{base}/v1/gateway/meta/chat/completions", device_token
    if settings.meta_api_key:
        return settings.meta_base_url.rstrip("/") + "/chat/completions", settings.meta_api_key
    return None


def available() -> bool:
    """True when this board can reach a cloud tier at all."""

    return _endpoint() is not None


async def stream_chat(messages: Sequence[dict], model: str) -> AsyncIterator[str]:
    """Yield text chunks from ``/chat/completions`` using SSE parsing.

    Transport or protocol failures propagate to the hybrid router.
    """

    endpoint = _endpoint()
    if endpoint is None:
        raise RuntimeError("No cloud route: pair the board or set META_API_KEY.")
    url, token = endpoint
    headers = {
        "Authorization": f"Bearer {token}",
        "Content-Type": "application/json",
    }
    payload: dict = {"model": model, "messages": list(messages), "stream": True}
    if settings.meta_reasoning_effort:
        payload["reasoning_effort"] = settings.meta_reasoning_effort

    async with httpx.AsyncClient(timeout=_TIMEOUT) as client:
        async with client.stream("POST", url, json=payload, headers=headers) as response:
            if response.status_code == 402:
                raise CloudCreditSpent()
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
