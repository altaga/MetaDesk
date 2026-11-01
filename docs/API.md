# MetaDesk API — canonical contract

One language for humans, the webpage, and AI agents.

## Lanes

| Lane | Prefix | Auth | Who |
|------|--------|------|-----|
| **control** | `/v1/...` | User JWT (via BFF cookies) | Web / Nova / admin |
| **gateway** | `/v1/gateway/...` | Device token (+ optional HMAC) | Board only — Meta Model API / search keys stay here |
| **board** | `/v1/devices/{id}/api/...` | User JWT + ownership | Web → relay → Jetson `/api/...` |
| **ops** | `/v1/ops/...` | User JWT or device token | Telemetry / debug |

The browser never talks to the desk cloud with secrets in JS. Always `https://app…/api/desk/...` (Next BFF).

## Response shape

- Every response includes header `X-Request-Id` (also usable as `trace_id`).
- Errors:

```json
{
  "ok": false,
  "error": { "code": "board_offline", "message": "…", "field": null, "retryable": true },
  "meta": { "request_id": "req_…", "lane": "board" }
}
```

## CORS

Allowlist only: production Vercel app, `metadesk*.vercel.app` previews, `localhost` / `127.0.0.1`.
No `*`. Credentials allowed when origin matches.

## Gateway HMAC (optional → required)

Headers: `X-Desk-Timestamp`, `X-Desk-Nonce`, `X-Desk-Signature`
Payload: `METHOD\npath?query\ntimestamp\nnonce\nsha256_hex(body)`
Key: device bearer token.
Enable with Worker var `GATEWAY_HMAC=required`. Until then signatures are verified if present.

## Board API (FastAPI on the Jetson)

These are the endpoints exposed by `apps/api` and reached by the web through the relay.

| Method | Path | What |
|---|---|---|
| `GET` | `/health` | Liveness, product name, `LLM_MODE`, active tier |
| `POST` | `/v1/auth/login` | Bootstrap-credential login → JWT |
| `GET` | `/v1/auth/me` | Current operator |
| `GET` | `/v1/board/info` | Hostname, platform, Python, desk root |
| `GET` | `/v1/board/health` | CPU / RAM / disk / temp / GPU snapshot |
| `POST` | `/v1/chat/sessions` | Create a session |
| `GET` | `/v1/chat/sessions` | List sessions: pinned first, then the manual order. Each row carries `pinned`, `position`, `updated_at` (last activity) and `message_count` |
| `PUT` | `/v1/chat/sessions/order` | Save the manual order (`{ids}`, top first; unknown ids ignored, unlisted sessions keep their relative order) |
| `DELETE` | `/v1/chat/sessions/empty?keep={id}` | Delete sessions with no messages (pinned ones and `keep` stay); returns `{deleted}` |
| `GET` | `/v1/chat/sessions/{id}/messages` | Session transcript |
| `PATCH` | `/v1/chat/sessions/{id}` | Rename and/or pin a session (`{title?, pinned?}`; title 1–120 chars) |
| `DELETE` | `/v1/chat/sessions/{id}` | Delete a session |
| `POST` | `/v1/chat/message/stream` | SSE turn: `route` → `token*` (`title` once, first turn only) → `tool*` → `done` |
| `GET` | `/v1/edge/files` | List a directory under the desk root |
| `GET` | `/v1/edge/files/read` | Read a file (capped) |

Everything under `/v1/` requires a Bearer JWT; `/health` and `/v1/auth/login` are public.

### Streaming events

`POST /v1/chat/message/stream` returns `text/event-stream`:

| Event | Payload |
|---|---|
| `route` | `{"tier": "local|fast|heavy|ultra", "reason": "…", "model": "…"}` |
| `token` | `{"text": "…"}` |
| `title` | `{"title": "…"}` — first turn of an untitled session only. The answering model writes it in a hidden `title` block of the same call (no extra model call); the message's first words stand in when it does not. A custom title is never replaced. |
| `tool` | `{"name": "run|read|list", "status": "ok|blocked", "reason"?: "…"}` |
| `done` | `{"tokens_in": n, "tokens_out": n, "cost_usd": f, "tier": "…", "model": "…"}` |

If the client disconnects mid-turn (the operator pressed Stop), the board still saves
the reply: whatever text arrived, followed by `(stopped)` on its own line, or just
`(stopped)` when nothing did. The session gets its fallback title the same way.

## Ops / traces (debug)

| Endpoint | Who | What |
|----------|-----|------|
| `GET /v1/ops/events` | Admin | Full timeline |
| `GET /v1/ops/traces/:trace_id` | Admin | One request's guide + tools |
| `GET /v1/ops/me/failures` | User | Failures only — no prompts/stdout |
| `POST /v1/ops/ingest` | Device | Board chat/tool events |
| `POST /v1/ops/guide-apply` | User | Nova UI apply/reject (no spoken text) |

Privacy: non-admin rows never store `input_text` / `output_text`. Commands stripped from features for users.

Kinds: `guide` · `chat` · `tool` · `gateway` · `relay` · `search`
Phases: `plan` · `apply` · `result` · `done`

## Cheat sheet

| Want | Call |
|------|------|
| Login / me | `/v1/auth/*` |
| Fleet | `GET /v1/devices` |
| Pair a board | board: `POST /v1/pair/start` → `POST /v1/pair/poll` · desk: `POST /v1/pair/claim` |
| Unpaired board setup (agent, USB only) | `GET /setup` · `POST /setup {name, password, wifi_ssid, wifi_password}` on `192.168.55.1:8800` |
| Nova | `POST /v1/guide/message/stream` |
| Chat on board | `/v1/devices/{id}/api/chat/message/stream` |
| Files | `/v1/devices/{id}/api/edge/files` |
| Meta (board only) | `/v1/gateway/meta/chat/completions` (device token; body forwarded to Meta, `stream` forced on, metered in `usage_ledger`) |

## Safe install (board chat tools)

Model fences:

```search
official Node.js install nvm
```

```install
tool: node
```

`install` re-searches, keeps only trusted hosts (nodejs.org, python.org, docs.expo.dev,
nvm-sh/nvm, npmjs.com, pypi.org, …), refuses typosquats / `curl|bash` from unknown
domains, then runs a curated recipe after human approval.
