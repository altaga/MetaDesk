"""MCP-shaped tools for expert profiles.

The board exposes these over one HTTP endpoint so an external agent can list,
search and read the operator's experts without touching the database itself.
"""

from __future__ import annotations

from .models import Brain
from .profile import profile_filename, section
from .service import list_brains, profile_body, search_profiles

_SERVER_INFO = {"name": "metadesk-brains", "version": "0.1.0"}

_TOOLS = [
    {
        "name": "brains_list",
        "description": "List expert profiles a conversation can call with @Name.",
        "inputSchema": {"type": "object", "properties": {}},
    },
    {
        "name": "brains_search",
        "description": "Find an expert profile by name, angle or method.",
        "inputSchema": {
            "type": "object",
            "properties": {"query": {"type": "string"}, "brain": {"type": "string"}},
            "required": ["query"],
        },
    },
    {
        "name": "brains_read",
        "description": "Read one expert profile as a markdown file.",
        "inputSchema": {
            "type": "object",
            "properties": {"brain": {"type": "string"}},
            "required": ["brain"],
        },
    },
]


def handle(user_id: int, message: dict) -> dict:
    """Dispatch one JSON-RPC message against the operator's experts."""

    method = str(message.get("method") or "")
    if method == "initialize":
        payload = {
            "protocolVersion": "2024-11-05",
            "capabilities": {"tools": {}},
            "serverInfo": _SERVER_INFO,
        }
    elif method == "tools/list":
        payload = {"tools": _TOOLS}
    elif method == "tools/call":
        payload = _call(user_id, message.get("params") or {})
    elif method.startswith("notifications/"):
        return {"jsonrpc": "2.0"}
    else:
        return _error(message.get("id"), -32601, "Method not found")
    return {"jsonrpc": "2.0", "id": message.get("id"), "result": payload}


def _call(user_id: int, params: dict) -> dict:
    name = str(params.get("name") or "")
    args = params.get("arguments") or {}
    if name == "brains_list":
        lines = [_summary(brain) for brain in list_brains(user_id)]
        text = "\n".join(lines) or "No expert profiles."
    elif name == "brains_search":
        hits = search_profiles(
            user_id, str(args.get("query") or ""), brain_name=str(args.get("brain") or "")
        )
        text = "\n".join(_summary(brain) for brain in hits) or "No matching expert."
    elif name == "brains_read":
        text = _read(user_id, str(args.get("brain") or ""))
    else:
        text = "Unknown tool."
    return {"content": [{"type": "text", "text": text}]}


def _summary(brain: Brain) -> str:
    angle = section(profile_body(brain), "Angle") or brain.description or "No angle yet."
    return f"@{brain.name} ({profile_filename(brain.name)}): {angle}"


def _read(user_id: int, wanted: str) -> str:
    brain = next(
        (item for item in list_brains(user_id) if item.name.lower() == wanted.lower()), None
    )
    if brain is None:
        return "Expert profile not found."
    body = profile_body(brain)
    return f"### {profile_filename(brain.name)}\n```markdown\n{body}\n```"


def _error(msg_id: object, code: int, message: str) -> dict:
    return {"jsonrpc": "2.0", "id": msg_id, "error": {"code": code, "message": message}}
