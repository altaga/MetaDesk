"""Web search for the desk.

A paired board sends the query through the cloud gateway, so the provider key
never lives on the board. An unpaired board falls back to its own key, bounded
by a lifetime credit ledger. With no key at all the call answers with a mock so
the chat tool path stays wired end to end.
"""

from __future__ import annotations

import httpx

from ..cloudlink import cloud_config
from ..config import settings
from ..ops.emit import emit_ops
from .breaker import is_open, record_failure, record_success
from .credits import BASIC_SEARCH_CREDITS, SearchCapReached, credits_remaining, refund, reserve

_BREAKER = "search"
_TIMEOUT = 30.0


def _mock(query: str) -> dict:
    """Deterministic stand-in used when no search key is reachable."""

    return {
        "query": query,
        "dummy": True,
        "results": [
            {
                "title": f"[Search mock] Results for: {query}",
                "url": "https://tavily.com",
                "content": "Set TAVILY_API_KEY to enable real search.",
            }
        ],
    }


async def _direct_search(api_key: str, query: str, max_results: int) -> dict:
    """Query the provider straight from the board, using its own key."""

    async with httpx.AsyncClient(timeout=_TIMEOUT) as client:
        response = await client.post(
            "https://api.tavily.com/search",
            json={
                "api_key": api_key,
                "query": query,
                "max_results": max_results,
                "search_depth": "basic",
            },
        )
        response.raise_for_status()
        return response.json()


async def _gateway_search(url: str, token: str, query: str, max_results: int) -> dict:
    """Query through the cloud gateway, which meters and holds the key."""

    async with httpx.AsyncClient(timeout=_TIMEOUT) as client:
        response = await client.post(
            f"{url}/v1/gateway/search",
            headers={"Authorization": f"Bearer {token}"},
            json={"query": query, "max_results": max_results},
        )
    if response.status_code == 402:
        detail = (response.json() or {}).get("detail") or {}
        raise SearchCapReached(int(detail.get("credits_spent") or 0), int(detail.get("credit_cap") or 0))
    response.raise_for_status()
    return response.json()


async def web_search(query: str, max_results: int = 5, credit_cap: int | None = None) -> dict:
    """Run a search, preferring the cloud gateway over a local key."""

    if is_open(_BREAKER):
        emit_ops(
            {
                "kind": "search",
                "status": "error",
                "error_code": "circuit_open",
                "note": "search breaker open — soft fail",
            }
        )
        data = _mock(query)
        data["circuit_open"] = True
        data["error"] = "Search circuit open — using soft fallback"
        return data

    cloud = cloud_config()
    try:
        if cloud:
            data = await _gateway_search(cloud[0], cloud[1], query, max_results)
        else:
            if not settings.tavily_api_key:
                return _mock(query)
            cap = settings.tavily_credit_cap if credit_cap is None else credit_cap
            remaining = reserve(cap, BASIC_SEARCH_CREDITS, query)
            try:
                data = await _direct_search(settings.tavily_api_key, query, max_results)
            except Exception:
                refund(BASIC_SEARCH_CREDITS, query)
                raise
            data["credits_charged"] = BASIC_SEARCH_CREDITS
            data["credits_remaining"] = remaining
            data["credit_cap"] = cap
        record_success(_BREAKER)
        return data
    except SearchCapReached:
        raise
    except Exception as exc:  # noqa: BLE001 - every upstream failure degrades to a mock
        opened = record_failure(_BREAKER, str(exc))
        emit_ops(
            {
                "kind": "search",
                "status": "error",
                "error_code": "circuit_open" if opened else "upstream_error",
                "note": str(exc)[:200],
            }
        )
        data = _mock(query)
        data["circuit_open"] = opened
        data["error"] = f"Search upstream failed ({type(exc).__name__}) — soft fallback"
        return data


def credit_status() -> dict:
    """How much of the board's own search budget is left."""

    cap = settings.tavily_credit_cap
    remaining = credits_remaining(cap)
    return {
        "tavily_credit_cap": cap,
        "tavily_credits_spent": cap - remaining,
        "tavily_credits_remaining": remaining,
    }
