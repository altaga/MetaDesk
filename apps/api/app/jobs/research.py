"""Background deep-research agent — multi-step search plus synthesis on board.

The job fans a topic into a few angles, searches each one, then writes a
markdown brief under ``.desk/research/``. It is intentionally paced so the
Agents view shows it running even when the search returns a mock.
"""

from __future__ import annotations

import asyncio
import logging
import re
import time
from datetime import datetime, timezone

from ..config import settings
from ..edge.files import write_file
from ..router import meta
from ..tools.tavily import web_search
from .service import is_cancelled

log = logging.getLogger(__name__)

RESEARCH_DIR = ".desk/research"
MIN_SECONDS_DEFAULT = 30.0
_ANGLES = (
    "overview key facts",
    "recent developments 2025 2026",
    "practical risks tradeoffs",
)


def _slug(topic: str) -> str:
    raw = re.sub(r"[^a-zA-Z0-9]+", "-", (topic or "research").strip().lower()).strip("-")
    return raw[:48] or "research"


def _angles(topic: str) -> list[str]:
    topic = topic.strip()
    return [f"{topic} — {angle}" for angle in _ANGLES]


async def _search_all(topic: str, *, job_id: str | None = None) -> list[dict]:
    cap = settings.tavily_credit_cap
    collected: list[dict] = []
    for query in _angles(topic):
        if is_cancelled(job_id):
            return collected
        data = await web_search(query, max_results=4, credit_cap=cap)
        hits = [
            {
                "title": str(row.get("title") or "")[:200],
                "url": str(row.get("url") or "")[:300],
                "content": str(row.get("content") or "")[:500],
            }
            for row in (data.get("results") or [])[:4]
        ]
        collected.append({"query": query, "results": hits, "dummy": bool(data.get("dummy"))})
        # Pace the steps so the job stays visibly running even against a mock.
        for _ in range(5):
            if is_cancelled(job_id):
                return collected
            await asyncio.sleep(0.5)
    return collected


def _fallback_report(topic: str, searches: list[dict]) -> str:
    lines = [f"# Research: {topic}", "", "## Angles searched", ""]
    for block in searches:
        lines.append(f"### {block.get('query')}")
        hits = block.get("results") or []
        if not hits:
            lines.append("- (no hits)")
            continue
        for hit in hits[:4]:
            title = hit.get("title") or hit.get("url") or "source"
            url = hit.get("url") or ""
            snippet = (hit.get("content") or "").strip()
            lines.append(f"- [{title}]({url})" if url else f"- {title}")
            if snippet:
                lines.append(f"  {snippet[:280]}")
        lines.append("")
    lines.extend(
        [
            "## Next actions",
            "1. Skim the sources above.",
            "2. Ask Desk to deepen any angle that matters.",
            "3. Fold findings into `.desk/WORK.md` if this blocks active work.",
            "",
        ]
    )
    return "\n".join(lines)


def _synthesize(topic: str, searches: list[dict]) -> str:
    sources: list[str] = []
    for block in searches:
        for hit in block.get("results") or []:
            sources.append(f"- {hit.get('title')} — {hit.get('url')}\n  {hit.get('content')}")
    blob = "\n".join(sources[:12]) or "(no sources — write a cautious outline anyway)"
    try:
        text = asyncio.run(
            meta.complete(
                [
                    {
                        "role": "system",
                        "content": (
                            "You are a desk research agent on a Jetson board. Write a tight markdown "
                            "brief in English: a title, 5-8 bullet findings, risks, and 3 next actions. "
                            "Cite URLs inline when present. No tool fences."
                        ),
                    },
                    {"role": "user", "content": f"Topic: {topic}\n\nSources:\n{blob}"},
                ],
                settings.meta_model_fast,
            )
        )
    except Exception as exc:  # noqa: BLE001 — a durable job must still leave an artifact
        log.warning("research synthesis failed: %s", exc)
        return _fallback_report(topic, searches) + f"\n_Note: synthesis error ({type(exc).__name__})._\n"
    return text or _fallback_report(topic, searches)


def run_research(*, topic: str, min_seconds: float | None = None, job_id: str | None = None) -> dict:
    """Run the search + synthesis pipeline and write the report file."""

    topic = (topic or "").strip()
    if not topic:
        return {"ok": False, "error": "research job needs topic: …", "path": None}
    floor = MIN_SECONDS_DEFAULT if min_seconds is None else max(5.0, min(float(min_seconds), 120.0))
    started = time.monotonic()
    if is_cancelled(job_id):
        return {"ok": False, "cancelled": True, "error": "Cancelled by operator", "path": None}
    try:
        searches = asyncio.run(_search_all(topic, job_id=job_id))
    except Exception as exc:  # noqa: BLE001
        log.exception("research search failed")
        return {"ok": False, "error": f"{type(exc).__name__}: {exc}", "path": None}
    if is_cancelled(job_id):
        return _cancelled_result(topic, searches, started)
    report = _synthesize(topic, searches)
    if is_cancelled(job_id):
        return _cancelled_result(topic, searches, started)
    stamp = datetime.now(timezone.utc).strftime("%Y%m%d-%H%M")
    rel = f"{RESEARCH_DIR}/{_slug(topic)}-{stamp}.md"
    write_file(rel, report.strip() + "\n")
    elapsed = time.monotonic() - started
    while elapsed < floor:
        if is_cancelled(job_id):
            return _done_result(topic, rel, searches, started, cancelled=True)
        time.sleep(min(0.5, floor - elapsed))
        elapsed = time.monotonic() - started
    return _done_result(topic, rel, searches, started)


def _counts(searches: list[dict]) -> tuple[int, int]:
    return len(searches), sum(len(block.get("results") or []) for block in searches)


def _cancelled_result(topic: str, searches: list[dict], started: float) -> dict:
    return {
        "ok": False,
        "cancelled": True,
        "error": "Cancelled by operator",
        "path": None,
        "searches": [{"query": block["query"], "n": len(block.get("results") or [])} for block in searches],
    }


def _done_result(topic: str, path: str, searches: list[dict], started: float, *, cancelled: bool = False) -> dict:
    angles, sources = _counts(searches)
    return {
        "ok": True,
        "cancelled": cancelled,
        "topic": topic,
        "path": path,
        "angles": angles,
        "sources": sources,
        "seconds": round(time.monotonic() - started, 1),
        "searches": [
            {"query": block["query"], "n": len(block.get("results") or []), "dummy": block.get("dummy")}
            for block in searches
        ],
    }
