"""Smoke tests that run without any network access.

The environment is pointed at a throwaway SQLite database and an unreachable
Ollama endpoint before the application is imported, so nothing touches
``./data`` and the local-model path is exercised in its offline form.
"""

from __future__ import annotations

import os
import tempfile
from pathlib import Path

import pytest

_TMP_ROOT = Path(tempfile.mkdtemp(prefix="metadesk-tests-"))
os.environ["DATABASE_URL"] = f"sqlite:///{(_TMP_ROOT / 'metadesk.db').as_posix()}"
os.environ["DESK_ROOT"] = str(_TMP_ROOT / "workspace")
os.environ["OLLAMA_BASE_URL"] = "http://127.0.0.1:59999"
os.environ["LLM_MODE"] = "hybrid"
os.environ["META_API_KEY"] = ""
# Never pick up a real pairing (or its cloud route) from the machine running the tests.
os.environ["STATE_DIR"] = str(_TMP_ROOT / "state")
os.environ["DEVICE_TOKEN"] = ""
os.environ["BOOTSTRAP_USERNAME"] = "admin"
os.environ["BOOTSTRAP_PASSWORD"] = "changeme"

from fastapi.testclient import TestClient  # noqa: E402

from app.main import app  # noqa: E402

USERNAME = "admin"
PASSWORD = "changeme"


@pytest.fixture(scope="module")
def client():
    with TestClient(app) as test_client:
        yield test_client


@pytest.fixture(scope="module")
def auth_headers(client) -> dict:
    response = client.post("/v1/auth/login", json={"username": USERNAME, "password": PASSWORD})
    assert response.status_code == 200, response.text
    token = response.json()["token"]
    return {"Authorization": f"Bearer {token}"}


def test_health(client):
    response = client.get("/health")
    assert response.status_code == 200
    body = response.json()
    assert body["ok"] is True
    assert body["name"] == "MetaDesk"
    assert response.headers.get("X-Request-Id", "").startswith("req_")


def test_login_and_me(client):
    login = client.post("/v1/auth/login", json={"username": USERNAME, "password": PASSWORD})
    assert login.status_code == 200
    payload = login.json()
    assert payload["token"]
    assert payload["expires_in"] > 0

    me = client.get("/v1/auth/me", headers={"Authorization": f"Bearer {payload['token']}"})
    assert me.status_code == 200
    assert me.json()["user"]["username"] == USERNAME


def test_login_rejects_bad_credentials(client):
    response = client.post("/v1/auth/login", json={"username": USERNAME, "password": "nope"})
    assert response.status_code == 401
    body = response.json()
    assert body["ok"] is False
    assert body["error"]["code"] == "invalid_credentials"


def test_board_health_returns_ram(client, auth_headers):
    response = client.get("/v1/board/health", headers=auth_headers)
    assert response.status_code == 200
    body = response.json()
    assert body["ok"] is True
    assert isinstance(body["ram"], dict)
    assert "total_mb" in body["ram"]


def test_session_rename(client, auth_headers):
    created = client.post("/v1/chat/sessions", json={}, headers=auth_headers)
    session_id = created.json()["session"]["id"]
    assert created.json()["session"]["title"] == "New session"

    renamed = client.patch(
        f"/v1/chat/sessions/{session_id}", json={"title": "  Relay   audit "}, headers=auth_headers
    )
    assert renamed.status_code == 200
    assert renamed.json()["session"]["title"] == "Relay audit"
    listed = client.get("/v1/chat/sessions", headers=auth_headers).json()["sessions"]
    assert any(row["id"] == session_id and row["title"] == "Relay audit" for row in listed)

    assert client.patch(f"/v1/chat/sessions/{session_id}", json={"title": "   "}, headers=auth_headers).status_code == 422
    assert client.patch(f"/v1/chat/sessions/{session_id}", json={"title": ""}, headers=auth_headers).status_code == 422
    assert client.patch("/v1/chat/sessions/999999", json={"title": "x"}, headers=auth_headers).status_code == 404
    assert client.patch(f"/v1/chat/sessions/{session_id}", json={"title": "x"}).status_code == 401


def test_session_lifecycle(client, auth_headers):
    created = client.post("/v1/chat/sessions", json={"title": "Smoke"}, headers=auth_headers)
    assert created.status_code == 200
    session_id = created.json()["session"]["id"]

    messages = client.get(f"/v1/chat/sessions/{session_id}/messages", headers=auth_headers)
    assert messages.status_code == 200
    assert messages.json()["messages"] == []


def test_stream_local_offline_still_completes(client, auth_headers):
    created = client.post("/v1/chat/sessions", json={"title": "Stream"}, headers=auth_headers)
    session_id = created.json()["session"]["id"]

    response = client.post(
        "/v1/chat/message/stream",
        json={"session_id": session_id, "text": "hello there", "tier": "local"},
        headers=auth_headers,
    )
    assert response.status_code == 200
    text = response.text
    assert "event: route" in text
    assert "event: done" in text

    messages = client.get(f"/v1/chat/sessions/{session_id}/messages", headers=auth_headers)
    roles = [message["role"] for message in messages.json()["messages"]]
    assert roles == ["user", "assistant"]



def _feed_all(chunks):
    from app.router.hybrid import TitleFilter

    titles = TitleFilter()
    shown = "".join(titles.feed(chunk) for chunk in chunks) + titles.flush()
    return titles.title, shown


def test_title_filter_strips_the_block_across_chunks():
    assert _feed_all(["``", "`ti", "tle\nRelay timeout", " on Kratos\n``", "`\nChecking ", "the relay."]) == (
        "Relay timeout on Kratos",
        "Checking the relay.",
    )
    # No block at all: every character still reaches the operator, code fences included.
    assert _feed_all(["Run this:\n``", "`run\nls\n```"]) == (None, "Run this:\n```run\nls\n```")
    # An unclosed block is shown rather than swallowed.
    assert _feed_all(["```title\nHalf"]) == (None, "```title\nHalf")


def _stream(client, auth_headers, session_id, text):
    return client.post(
        "/v1/chat/message/stream",
        json={"session_id": session_id, "text": text, "tier": "local"},
        headers=auth_headers,
    ).text


def test_first_turn_names_the_session(client, auth_headers, monkeypatch):
    from app.router import hybrid

    seen = []

    async def fake_tokens(tier, model, messages):
        seen.append(messages[0]["content"])
        for chunk in ["```title\nRelay timeout on Kratos.\n```\n", "Looking at ", "the relay."]:
            yield chunk

    monkeypatch.setattr(hybrid, "_stream_tokens", fake_tokens)
    session_id = client.post("/v1/chat/sessions", json={}, headers=auth_headers).json()["session"]["id"]

    first = _stream(client, auth_headers, session_id, "Check why the relay times out")
    assert 'event: title\ndata: {"title": "Relay timeout on Kratos"}' in first
    assert "```title" not in first
    assert hybrid.TITLE_PROMPT in seen[0]
    messages = client.get(f"/v1/chat/sessions/{session_id}/messages", headers=auth_headers).json()["messages"]
    assert messages[-1]["content"] == "Looking at the relay."

    # Later turns neither ask for nor apply a title.
    second = _stream(client, auth_headers, session_id, "and now?")
    assert "event: title" not in second
    assert hybrid.TITLE_PROMPT not in seen[1]
    listed = client.get("/v1/chat/sessions", headers=auth_headers).json()["sessions"]
    assert any(row["id"] == session_id and row["title"] == "Relay timeout on Kratos" for row in listed)


def test_first_turn_falls_back_to_the_message(client, auth_headers, monkeypatch):
    from app.router import hybrid

    async def quiet_tokens(tier, model, messages):
        yield "Sure."

    monkeypatch.setattr(hybrid, "_stream_tokens", quiet_tokens)
    session_id = client.post("/v1/chat/sessions", json={}, headers=auth_headers).json()["session"]["id"]
    body = _stream(client, auth_headers, session_id, "  list the workspace and read every README file in it please ")
    assert 'event: title\ndata: {"title": "List the workspace and read every README"}' in body
    assert body.index("event: title") < body.index("event: done")

    # A session the operator already named keeps its name.
    named = client.post("/v1/chat/sessions", json={"title": "Mine"}, headers=auth_headers).json()["session"]["id"]
    assert "event: title" not in _stream(client, auth_headers, named, "hello")


def test_session_pin_order_and_cleanup(client, auth_headers):
    from app.chat import service

    def make(title=None):
        body = {"title": title} if title else {}
        return client.post("/v1/chat/sessions", json=body, headers=auth_headers).json()["session"]

    def order():
        return [row["id"] for row in client.get("/v1/chat/sessions", headers=auth_headers).json()["sessions"]]

    a, b, c = make("A"), make("B"), make("C")
    assert c["position"] < b["position"] < a["position"]  # new sessions land on top
    assert c["message_count"] == 0 and c["pinned"] is False and c["updated_at"]
    assert order().index(c["id"]) < order().index(b["id"]) < order().index(a["id"])

    # Manual order, with an unknown id and a duplicate ignored.
    saved = client.put("/v1/chat/sessions/order", json={"ids": [a["id"], 999999, c["id"], a["id"]]}, headers=auth_headers)
    assert saved.status_code == 200
    ids = [row["id"] for row in saved.json()["sessions"]]
    assert ids.index(a["id"]) < ids.index(c["id"]) < ids.index(b["id"])

    # Pinned sessions float above the manual order.
    pinned = client.patch(f"/v1/chat/sessions/{b['id']}", json={"pinned": True}, headers=auth_headers).json()["session"]
    assert pinned["pinned"] is True and pinned["title"] == "B"
    assert order()[0] == b["id"]
    assert client.patch(f"/v1/chat/sessions/{b['id']}", json={"title": ""}, headers=auth_headers).status_code == 422

    # Activity is tracked, and cleanup removes only untouched, unpinned sessions.
    service.add_message(a["id"], "user", "hello")
    row = next(r for r in client.get("/v1/chat/sessions", headers=auth_headers).json()["sessions"] if r["id"] == a["id"])
    assert row["message_count"] == 1 and row["updated_at"] >= a["updated_at"]
    keep = make()
    removed = client.delete(f"/v1/chat/sessions/empty?keep={keep['id']}", headers=auth_headers).json()["deleted"]
    assert removed >= 1
    left = order()
    assert a["id"] in left and b["id"] in left and keep["id"] in left and c["id"] not in left


def test_stopped_reply_is_kept(client, auth_headers, monkeypatch):
    import asyncio

    from app.chat import service
    from app.router import hybrid

    async def fake_tokens(tier, model, messages):
        for chunk in ["Half of ", "an answer", " that never ends"]:
            yield chunk

    monkeypatch.setattr(hybrid, "_stream_tokens", fake_tokens)
    session_id = client.post("/v1/chat/sessions", json={}, headers=auth_headers).json()["session"]["id"]

    async def stop_after_two_tokens():
        stream = service.stream_reply(session_id, "Explain the relay", "local")
        tokens = 0
        async for frame in stream:
            tokens += frame.startswith("event: token")
            if tokens == 2:
                break
        await stream.aclose()

    asyncio.run(stop_after_two_tokens())
    messages = client.get(f"/v1/chat/sessions/{session_id}/messages", headers=auth_headers).json()["messages"]
    assert [row["role"] for row in messages] == ["user", "assistant"]
    assert messages[-1]["content"] == f"Half of an answer\n\n{service.STOPPED_MARK}"
    listed = client.get("/v1/chat/sessions", headers=auth_headers).json()["sessions"]
    assert any(row["id"] == session_id and row["title"] == "Explain the relay" for row in listed)


def test_paired_board_reaches_muse_through_the_gateway(monkeypatch):
    from app.router import hybrid, meta

    monkeypatch.setattr(meta, "cloud_config", lambda: ("https://cloud.example", "device-tok"))
    monkeypatch.setattr(meta.settings, "meta_api_key", "local-key")
    assert meta._endpoint() == ("https://cloud.example/v1/gateway/meta/chat/completions", "device-tok")
    decision = hybrid.resolve("Refactor the relay", "fast")
    assert (decision.tier, decision.reason) == ("fast", "explicit_request")


def test_no_cloud_route_falls_back_to_local(monkeypatch):
    from app.router import hybrid, meta

    monkeypatch.setattr(meta, "cloud_config", lambda: None)
    monkeypatch.setattr(meta.settings, "meta_api_key", "")
    decision = hybrid.resolve("Refactor the relay", "heavy")
    assert (decision.tier, decision.reason) == ("local", "no_meta_key_fallback_local")


def test_gateway_stream_and_spent_credit(monkeypatch):
    import asyncio
    import json

    import httpx

    from app.router import hybrid, meta

    seen: dict = {}
    status = {"code": 200}

    def handler(request: httpx.Request) -> httpx.Response:
        seen["url"] = str(request.url)
        seen["auth"] = request.headers.get("authorization")
        seen["body"] = json.loads(request.content)
        if status["code"] == 402:
            return httpx.Response(402, json={"detail": "cloud_credit_used"})
        frames = [
            {"choices": [{"delta": {"content": "Hi from "}}]},
            {"choices": [{"delta": {"content": "Muse"}}]},
        ]
        body = "".join(f"data: {json.dumps(frame)}\n\n" for frame in frames) + "data: [DONE]\n\n"
        return httpx.Response(200, text=body, headers={"content-type": "text/event-stream"})

    real_client = httpx.AsyncClient
    monkeypatch.setattr(meta.httpx, "AsyncClient", lambda **kw: real_client(transport=httpx.MockTransport(handler), **kw))
    monkeypatch.setattr(meta, "cloud_config", lambda: ("https://cloud.example", "device-tok"))
    monkeypatch.setattr(hybrid, "record_usage", lambda *args: None)

    async def reply() -> str:
        text = ""
        async for kind, payload in hybrid.stream_turn(text="Refactor the relay", tier_request="fast", allow_tools=False):
            if kind == "token":
                text += payload["text"]
        return text

    assert asyncio.run(reply()) == "Hi from Muse"
    assert seen["url"] == "https://cloud.example/v1/gateway/meta/chat/completions"
    assert seen["auth"] == "Bearer device-tok"
    assert seen["body"]["model"] == meta.settings.meta_model_fast
    assert seen["body"]["reasoning_effort"] == meta.settings.meta_reasoning_effort

    status["code"] = 402
    assert asyncio.run(reply()) == hybrid.CLOUD_CREDIT_MESSAGE


def test_patch_waits_for_approval_and_then_writes(client, auth_headers):
    from app.chat import desk_tools
    from app.config import desk_root_abs

    target = desk_root_abs() / "demo" / "app.js"
    target.parent.mkdir(parents=True, exist_ok=True)
    target.write_text("render();\nsaveItemz(load());\n", encoding="utf-8")

    body = "demo/app.js\n<<<<<<< SEARCH\nsaveItemz(load());\n=======\nsaveItems(load());\n>>>>>>> REPLACE"
    pending = desk_tools.execute("patch", body)
    assert pending["status"] == "pending" and pending["old"] == "saveItemz(load());"
    assert "saveItemz" in target.read_text(encoding="utf-8")  # nothing written yet

    approved = client.post(
        f"/v1/chat/approvals/{pending['approval_id']}", json={"approve": True}, headers=auth_headers
    ).json()["result"]
    assert approved["status"] == "ok"
    assert target.read_text(encoding="utf-8") == "render();\nsaveItems(load());\n"

    # A decided proposal is gone; deciding again is a 404.
    again = client.post(f"/v1/chat/approvals/{pending['approval_id']}", json={"approve": True}, headers=auth_headers)
    assert again.status_code == 404


def test_patch_denied_or_stale_never_writes(client, auth_headers):
    from app.chat import desk_tools
    from app.config import desk_root_abs

    target = desk_root_abs() / "demo" / "stale.js"
    target.parent.mkdir(parents=True, exist_ok=True)
    target.write_text("a = 1;\n", encoding="utf-8")
    body = "demo/stale.js\n<<<<<<< SEARCH\na = 1;\n=======\na = 2;\n>>>>>>> REPLACE"

    denied = desk_tools.execute("patch", body)
    result = client.post(f"/v1/chat/approvals/{denied['approval_id']}", json={"approve": False}, headers=auth_headers)
    assert result.json()["result"]["status"] == "denied"
    assert target.read_text(encoding="utf-8") == "a = 1;\n"

    stale = desk_tools.execute("patch", body)
    target.write_text("a = 3;\n", encoding="utf-8")  # someone edited the file meanwhile
    result = client.post(f"/v1/chat/approvals/{stale['approval_id']}", json={"approve": True}, headers=auth_headers)
    assert result.json()["result"]["reason"] == "file_changed"
    assert target.read_text(encoding="utf-8") == "a = 3;\n"

    assert desk_tools.execute("patch", "demo/stale.js\nno markers")["reason"] == "bad_patch_format"
    escape = "../outside.js\n<<<<<<< SEARCH\nx\n=======\ny\n>>>>>>> REPLACE"
    assert desk_tools.execute("patch", escape)["reason"] == "path_out_of_root"


def test_tool_results_go_back_to_the_model(monkeypatch):
    import asyncio

    from app.config import desk_root_abs
    from app.router import hybrid

    target = desk_root_abs() / "demo" / "loop.js"
    target.parent.mkdir(parents=True, exist_ok=True)
    target.write_text("saveItemz(x);\n", encoding="utf-8")
    calls: list[list[dict]] = []
    replies = [
        "Let me read it.\n```read\ndemo/loop.js\n```",
        "The name is misspelled.\n```patch\ndemo/loop.js\n<<<<<<< SEARCH\nsaveItemz(x);\n=======\nsaveItems(x);\n>>>>>>> REPLACE\n```",
        "should never be asked",
    ]

    async def fake_tokens(tier, model, messages):
        calls.append(list(messages))
        yield replies[len(calls) - 1]

    monkeypatch.setattr(hybrid, "_stream_tokens", fake_tokens)
    monkeypatch.setattr(hybrid, "record_usage", lambda *args: None)

    async def turn():
        return [item async for item in hybrid.stream_turn(text="Fix the app", tier_request="local")]

    events = asyncio.run(turn())
    tools = [payload for kind, payload in events if kind == "tool"]
    assert [tool["name"] for tool in tools] == ["read", "patch"]
    assert tools[1]["status"] == "pending"
    assert len(calls) == 2  # the patch ends the turn; no third call
    assert "saveItemz(x);" in calls[1][-1]["content"]  # the read result was fed back
