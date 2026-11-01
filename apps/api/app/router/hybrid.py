"""Tier resolution and the streaming turn generator.

The hybrid router combines the intent heuristics, the ``LLM_MODE`` policy, whether
a cloud route exists (the paired gateway, or a local Meta key) and the daily cloud
budget into one decision, then
streams the turn from the matching provider.
"""

from __future__ import annotations

from datetime import datetime, timezone
from typing import Any, AsyncIterator, Sequence

from .. import db
from ..config import settings
from ..chat import desk_tools
from ..ops.emit import emit_tool_results, new_trace_id
from . import intent, local_llm, meta
from .types import CLOUD_TIERS, RouteDecision, TIERS

SYSTEM_PROMPT = (
    "You are MetaDesk, the operator assistant running on a Jetson desk board. "
    "You help the operator inspect the board, read and list files inside the "
    "desk workspace, run shell commands, search the web, and start background "
    "agents. Be concise and practical. When you want the board to act, emit a "
    "fenced block tagged run, read or list followed by a single relative path or "
    "command. To search the web, emit a fenced block tagged search followed by "
    "the query. For work that should outlive the chat (research, deploy, checks, "
    "bakeoff, probe, record a screen demo), emit a fenced block tagged job: first "
    "line kind, then the fields that kind needs, for example\n"
    "```job\nkind: research\ntopic: edge agents on Jetson\n```\n"
    "After enqueueing a job, tell the operator it is running in the background and "
    "will post its result in chat — never claim the job already finished."
)

#: Added on a session's first turn so the same call also names the session.
TITLE_PROMPT = (
    "This is the first message of a new session. Your reply must start with a "
    "fenced block tagged title holding a 2 to 6 word title that names the "
    "operator's request (the topic, not a greeting), in the operator's language, "
    "with no quotes or trailing period, for example\n"
    "```title\nRelay timeout on Kratos\n```\n"
    "The board hides that block from the operator. Then answer normally."
)

#: Appended to the first user message sent to the model (never stored).
TITLE_NUDGE = "(Begin your reply with the ```title block, then answer.)"

_TITLE_OPEN = "```title"
_FENCE_CLOSE = "```"

#: Shown to the operator when the local model cannot be reached.
LOCAL_OFFLINE_MESSAGE = (
    "The local model is offline right now, so I could not answer on the board. "
    "Start Ollama and try again."
)

#: Shown to the operator when an upstream cloud call fails.
CLOUD_UNREACHABLE_MESSAGE = (
    "The cloud model could not be reached from this board. Please check the "
    "network or Meta API credentials and try again."
)

CLOUD_CREDIT_MESSAGE = (
    "This account's cloud credit is used up, so Muse could not answer. "
    "Pick the local tier, or try again once the credit resets."
)


def model_for_tier(tier: str) -> str:
    """Map a tier onto its concrete model name."""

    if tier == "local":
        return settings.ollama_model
    if tier == "heavy":
        return settings.meta_model_heavy
    if tier == "ultra":
        return settings.meta_model_ultra
    return settings.meta_model_fast


def cloud_spend_today_usd() -> float:
    """Total cloud spend recorded for the current UTC day."""

    today = datetime.now(timezone.utc).date().isoformat()
    row = db.fetchone(
        "SELECT COALESCE(SUM(cost_usd), 0.0) AS spent FROM usage_ledger WHERE ts LIKE ?",
        (f"{today}%",),
    )
    return float(row["spent"]) if row else 0.0


def record_usage(tier: str, tokens_in: int, tokens_out: int, cost_usd: float) -> None:
    """Append a cloud usage entry to the ledger."""

    db.execute(
        "INSERT INTO usage_ledger (ts, tier, tokens_in, tokens_out, cost_usd) VALUES (?, ?, ?, ?, ?)",
        (datetime.now(timezone.utc).isoformat(), tier, tokens_in, tokens_out, cost_usd),
    )


def resolve(text: str, tier_request: str | None) -> RouteDecision:
    """Resolve the tier, reason and model for a turn."""

    requested = (tier_request or "auto").strip().lower()
    if requested in TIERS:
        tier, reason = requested, "explicit_request"
    else:
        tier, reason = intent.decide_tier(text)

    mode = settings.llm_mode
    if mode == "local_only":
        tier, reason = "local", "mode_local_only"
    elif mode == "cloud_only":
        if tier == "local":
            tier, reason = "fast", "mode_cloud_only_remap"
    else:  # hybrid
        if tier != "local" and not meta.available():
            tier, reason = "local", "no_meta_key_fallback_local"
        if tier != "local" and cloud_spend_today_usd() >= settings.meta_daily_budget_usd:
            tier, reason = "local", "daily_budget_exhausted"

    return RouteDecision(tier=tier, reason=reason, model=model_for_tier(tier))


def estimate_tokens(pieces: Sequence[str]) -> int:
    """Rough token estimate (about four characters per token)."""

    total = sum(len(piece) for piece in pieces)
    return max(0, total // 4)


def compute_cost_usd(tier: str, tokens_in: int, tokens_out: int) -> float:
    """Cost of a cloud turn in US dollars; local turns are free."""

    if tier not in CLOUD_TIERS:
        return 0.0
    cost = (tokens_in / 1_000_000) * settings.meta_usd_per_1m_input
    cost += (tokens_out / 1_000_000) * settings.meta_usd_per_1m_output
    return round(cost, 6)


def build_messages(
    history: Sequence[dict], text: str, context: str = "", *, want_title: bool = False
) -> list[dict]:
    """Assemble the chat payload sent to the provider.

    ``context`` carries the operator's expert profiles and shared memory; it is
    appended to the system prompt so it never overwrites the base contract.
    ``want_title`` asks the model to name the session in a ``title`` block.
    """

    system = SYSTEM_PROMPT
    extra = (context or "").strip()
    if extra:
        system = f"{system}\n\n{extra}"
    if want_title:
        # Last in the system prompt and echoed in the turn: small models follow it there.
        system = f"{system}\n\n{TITLE_PROMPT}"
    messages: list[dict] = [{"role": "system", "content": system}]
    for item in history:
        role = item.get("role")
        content = item.get("content")
        if role in {"user", "assistant"} and content:
            messages.append({"role": role, "content": content})
    messages.append({"role": "user", "content": f"{text}\n\n{TITLE_NUDGE}" if want_title else text})
    return messages


async def _stream_tokens(tier: str, model: str, messages: Sequence[dict]) -> AsyncIterator[str]:
    if tier == "local":
        async for chunk in local_llm.stream_chat(messages, model):
            yield chunk
    else:
        async for chunk in meta.stream_chat(messages, model):
            yield chunk


class TitleFilter:
    """Pull a ```title block out of streamed text before the operator sees it.

    Text that might be the start of the block is held back until it is clear
    either way, so the fence never flashes on screen.
    """

    def __init__(self) -> None:
        self._buffer = ""
        self._done = False
        self.title: str | None = None

    def feed(self, chunk: str) -> str:
        if self._done:
            return chunk
        self._buffer += chunk
        start = self._buffer.find(_TITLE_OPEN)
        if start == -1:
            cut = len(self._buffer) - self._partial_open()
            out, self._buffer = self._buffer[:cut], self._buffer[cut:]
            return out
        end = self._buffer.find(_FENCE_CLOSE, start + len(_TITLE_OPEN))
        if end == -1:
            out, self._buffer = self._buffer[:start], self._buffer[start:]
            return out
        self.title = self._buffer[start + len(_TITLE_OPEN) : end].strip() or None
        before, after = self._buffer[:start], self._buffer[end + len(_FENCE_CLOSE) :]
        self._buffer, self._done = "", True
        # The answer usually follows on a fresh line; drop the gap the block leaves.
        return before + (after if before.strip() else after.lstrip("\r\n"))

    def flush(self) -> str:
        """Whatever is still held back once the stream ends (an unclosed block is kept)."""

        out, self._buffer = self._buffer, ""
        return out

    def _partial_open(self) -> int:
        for size in range(min(len(_TITLE_OPEN) - 1, len(self._buffer)), 0, -1):
            if _TITLE_OPEN.startswith(self._buffer[-size:]):
                return size
        return 0


def _ops_item(event: dict[str, Any]) -> dict[str, Any]:
    """Shape a tool event for the ops telemetry ledger."""

    status = event.get("status")
    return {
        "kind": event.get("name"),
        "ok": status == "ok",
        "skipped": status == "blocked",
        "exit_code": event.get("exit_code"),
        "command": event.get("command"),
        "path": event.get("path") or event.get("query"),
        "stdout": event.get("output") or event.get("content") or "",
        "reason": event.get("reason"),
        "error": event.get("reason") if status == "error" else None,
    }


async def stream_turn(
    *,
    text: str,
    history: Sequence[dict] | None = None,
    tier_request: str | None = "auto",
    session_id: int | None = None,
    context: str = "",
    allow_tools: bool = True,
    want_title: bool = False,
) -> AsyncIterator[tuple[str, dict[str, Any]]]:
    """Yield ``("route"|"token"|"title"|"tool"|"done", payload)`` events for one turn.

    ``context`` is extra system-prompt material (expert profiles, shared
    memory) the caller resolved before the turn. ``allow_tools`` is False for
    callers that want the model's words only — a mission turn must never touch
    the board. The generator never raises: provider failures become a single
    explanatory token followed by a normal ``done`` event. With ``want_title``
    the same model call also names the session: the name arrives as one
    ``title`` event and never shows in the reply.
    """

    history = list(history or [])
    decision = resolve(text, tier_request)
    yield ("route", {"tier": decision.tier, "reason": decision.reason, "model": decision.model})

    messages = build_messages(history, text, context, want_title=want_title)
    assistant_text = ""
    failed = False
    titles = TitleFilter() if want_title else None
    try:
        async for chunk in _stream_tokens(decision.tier, decision.model, messages):
            if titles is not None:
                had_title = titles.title is not None
                chunk = titles.feed(chunk)
                if titles.title and not had_title:
                    yield ("title", {"title": titles.title})
            if chunk:
                assistant_text += chunk
                yield ("token", {"text": chunk})
        if titles is not None and (rest := titles.flush()):
            assistant_text += rest
            yield ("token", {"text": rest})
    except Exception as exc:  # noqa: BLE001 - degrade gracefully, never crash the stream
        failed = True
        if decision.tier == "local":
            notice = LOCAL_OFFLINE_MESSAGE
        elif isinstance(exc, meta.CloudCreditSpent):
            notice = CLOUD_CREDIT_MESSAGE
        else:
            notice = CLOUD_UNREACHABLE_MESSAGE
        assistant_text += notice
        yield ("token", {"text": notice})

    if not failed and allow_tools:
        tool_events: list[dict[str, Any]] = []
        for kind, argument in desk_tools.fenced_calls(assistant_text):
            if kind == "search":
                tool_events.append(await desk_tools.run_search(argument))
            elif kind == "job":
                tool_events.append(await desk_tools.run_job(argument, session_id=session_id))
            else:
                tool_events.append(desk_tools.execute(kind, argument))

        # A clear "search the web" request runs even when the model stayed quiet.
        if not any(event.get("name") == "search" for event in tool_events) and desk_tools.wants_web_search(text):
            tool_events.append(await desk_tools.run_search(desk_tools.web_query_from(text)))

        for tool_event in tool_events:
            yield ("tool", tool_event)
        if tool_events:
            emit_tool_results(
                trace_id=new_trace_id(),
                session_id=None,
                results=[_ops_item(event) for event in tool_events],
            )

    tokens_in = estimate_tokens([message["content"] for message in messages])
    tokens_out = estimate_tokens([assistant_text])
    cost_usd = compute_cost_usd(decision.tier, tokens_in, tokens_out)

    if decision.tier in CLOUD_TIERS and not failed:
        record_usage(decision.tier, tokens_in, tokens_out, cost_usd)

    yield (
        "done",
        {
            "tokens_in": tokens_in,
            "tokens_out": tokens_out,
            "cost_usd": cost_usd,
            "tier": decision.tier,
            "model": decision.model,
        },
    )
