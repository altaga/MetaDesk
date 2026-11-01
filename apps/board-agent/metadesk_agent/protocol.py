"""Frames exchanged on the board's relay WebSocket.

Text JSON, mirroring ``apps/cloud/src/relay/protocol.ts``. Request bodies and
terminal bytes travel as base64 so the frames stay valid UTF-8.
"""

from __future__ import annotations

from typing import Annotated, Literal, Union

from pydantic import BaseModel, Field, TypeAdapter

# The cloud caps request bodies before they reach the socket.
MAX_REQUEST_BODY = 3 * 1024 * 1024
# Size of each ``chunk`` frame sent back for a relayed HTTP response.
RESPONSE_CHUNK_BYTES = 64 * 1024
# Headers the relay forwards from the browser, pulled back off the request.
FORWARD_REQUEST_HEADERS = ("content-type", "accept", "referer", "x-desk-preview-base")


class RelayUser(BaseModel):
    """The operator the cloud authenticated for this frame."""

    id: int
    username: str


class ReqFrame(BaseModel):
    t: Literal["req"]
    id: str
    method: str
    path: str
    headers: dict[str, str] = Field(default_factory=dict)
    user: RelayUser
    body: str | None = None


class CancelFrame(BaseModel):
    t: Literal["cancel"]
    id: str


class HelloAckFrame(BaseModel):
    t: Literal["hello_ack"]


class BeatAckFrame(BaseModel):
    t: Literal["beat_ack"]


class TermOpenFrame(BaseModel):
    t: Literal["term_open"]
    sid: str
    cols: int = 100
    rows: int = 30
    user: RelayUser


class TermInFrame(BaseModel):
    t: Literal["term_in"]
    sid: str
    data: str


class TermResizeFrame(BaseModel):
    t: Literal["term_resize"]
    sid: str
    cols: int
    rows: int


class TermCloseFrame(BaseModel):
    t: Literal["term_close"]
    sid: str


ToAgent = Annotated[
    Union[ReqFrame, CancelFrame, HelloAckFrame, BeatAckFrame, TermOpenFrame, TermInFrame, TermResizeFrame, TermCloseFrame],
    Field(discriminator="t"),
]

_to_agent_adapter: TypeAdapter[ToAgent] = TypeAdapter(ToAgent)


def parse_to_agent(raw: str) -> ToAgent:
    """Validate an inbound frame, raising ``ValueError`` on anything unknown."""

    return _to_agent_adapter.validate_json(raw)


def hello(version: str, hostname: str, board_emu: bool = False) -> dict:
    return {"t": "hello", "version": version, "hostname": hostname, "board_emu": board_emu}


def beat() -> dict:
    return {"t": "beat"}


def res(frame_id: str, status: int, headers: dict[str, str]) -> dict:
    return {"t": "res", "id": frame_id, "status": status, "headers": headers}


def chunk(frame_id: str, b64: str) -> dict:
    return {"t": "chunk", "id": frame_id, "b64": b64}


def end(frame_id: str, error: str | None = None) -> dict:
    frame: dict = {"t": "end", "id": frame_id}
    if error is not None:
        frame["error"] = error
    return frame


def term_out(sid: str, b64: str) -> dict:
    return {"t": "term_out", "sid": sid, "b64": b64}


def term_exit(sid: str, code: int | None) -> dict:
    return {"t": "term_exit", "sid": sid, "code": code}
