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
