# AGENTS.md

Orientation for AI coding agents working in **MetaDesk**.
Humans should read [README.md](./README.md); this file is the machine-facing contract.

## What this repo is

A monorepo for an operator desk that runs **on an NVIDIA Jetson** (or a Docker
`board-emu`). Chat drives shell / files / browser / jobs on the board. A hybrid router
keeps light work local (an Ollama model on the board) and sends hard work to Meta's
**Muse** models (Spark / Wonder) through the Meta Model API. Cloudflare is the account plane (auth,
pairing, gateway keys, relay).

[docs/ARCHITECTURE.md](./docs/ARCHITECTURE.md) and [docs/API.md](./docs/API.md) hold the
canonical detail. This file is the short contract — read it before touching cross-app
behavior, and keep both docs current when architecture changes.

## Layout

| Path | What | Language |
|---|---|---|
| `apps/api` | FastAPI on the board. Entry `app/main.py`. | Python 3.11 |
| `apps/web` | Next.js desk UI (the product surface) + BFF at `/api/desk/*`. | TypeScript |
| `apps/cloud` | Cloudflare Worker + D1 + Durable Object relay. | TypeScript |
| `apps/board-agent` | Outbound-WS agent on the board. | Python |
| `apps/board-emu` | Docker fake boards. | Docker |
| `docs/` | `ARCHITECTURE.md` · `API.md` · `brand/`. | Markdown |
| `scripts/`, `Skills/`, `.cf/` | Local-only operator tooling — **gitignored on disk**. | Python / shell |

`apps/api/app/` modules: `auth` `router` `chat` `board` `edge`.
`apps/cloud/src/` modules: `auth` `devices` `gateway` `guide` `ops` `pairing` `relay`
`subscription`.

Where the hot spots are:

- Desk tool fences — `apps/api/app/chat/desk_tools.py`
- Approval gates — `apps/api/app/chat/guardrails.py`
- Tier selection — `apps/api/app/router/hybrid.py` (+ `intent.py`, `meta.py`, `local_llm.py`)
- Secrets + metering (keys never leave) — `apps/cloud/src/gateway/`
- Relay — `apps/cloud/src/relay/DeviceRelay.ts`
- UI root — `apps/web/src/features/desk/DeskShell.tsx`

## Commands

Root `package.json` wrappers:

```bash
npm run install:api      # pip install -r apps/api/requirements.txt
npm run install:web      # npm install in apps/web
npm run install:agent    # pip install -r apps/board-agent/requirements.txt
npm run dev:api          # uvicorn app.main:app --reload --host 0.0.0.0 --port 8000
npm run dev:web          # next dev
npm run dev:agent        # python -m metadesk_agent
```

API tests (from `apps/api`):

```bash
python -m pytest tests -q
```

Cloud (from `apps/cloud`):

```bash
npx wrangler dev
npx wrangler deploy -c egress.wrangler.toml   # Meta egress Worker, first time and when it changes
npx wrangler deploy
npx wrangler d1 migrations apply metadesk --remote
```

## Invariants — do not break these

- **Secrets never leave the Worker.** The Meta Model API key lives in `apps/cloud`
  (`gateway/`). The board holds only a `device_token`; never print secret values.
  `secrets.env`, `.env`, `.env.local`, `.dev.vars` stay gitignored — only `*.env.example`
  templates are tracked.
- **Board dials out, never in.** Remote traffic uses the outbound WebSocket relay
  (`/v1/agent/connect`). Do not add inbound ports to the board. The one exception is
  the **unpaired** board's `/setup` endpoint for the desk's `/pair` wizard: the agent
  serves it on the USB gadget link only (`192.168.55.1:8800`,
  `apps/board-agent/metadesk_agent/setup_server.py`), with CORS limited to the desk
  origins, and shuts it down the moment the board is paired. Never bind it to `0.0.0.0`
  on a real board or keep it after pairing. (`apps/board-emu` binds it to `0.0.0.0`
  *inside* the container and publishes it on the host's `127.0.0.1:18101-18103` only.)
- **Every response carries `X-Request-Id`** (= `trace_id`). Errors use the
  `{ok, error:{code,message,field,retryable}, meta}` shape (see `docs/API.md`).
- **`LLM_MODE` values are `hybrid` | `cloud_only` | `local_only`.** `hybrid` is the
  code default. "dummy" is not a router mode.
- **Approval gates stay on.** `patch`, destructive `run`, and `deploy` require human
  approval. `install` re-searches and only runs vetted recipes from trusted hosts.
- **Money has one source of truth.** Cloud spend is metered in D1 `usage_ledger`; the
  board keeps a soft daily budget (`META_DAILY_BUDGET_USD`). No Stripe, no SKUs.
- **One writer per surface.** The board owns local disk/SQLite; Cloudflare D1 owns
  accounts/fleet/ledger. Don't mirror what you can fetch.

## Conventions

- **Language:** code, comments, UI copy, and docs are **English**. Commit messages too.
  (Conversation with the operator may be Spanish.)
- **Naming.** The human-facing product name is **MetaDesk** (one word, title case)
  everywhere it is shown to a person. Machine identifiers stay lowercase-kebab
  `metadesk`: npm scope `@metadesk/*`, the D1 database `metadesk`, the config dir
  `~/.config/metadesk`, the SQLite file `metadesk.db`.
  Boards are named by the operator; **Nova** is the on-screen guide only.
- **Model names.** Talk about Meta's models by their real identifiers:
  `muse-spark-1.3-contributor` (fast), `muse-spark-1.3` (heavy), `muse-wonder-1.0`
  (ultra). The `local` tier is whatever Ollama serves on the board (`OLLAMA_MODEL`,
  default `qwen3.5:4b`); call it local processing in copy, not Muse Glimmer, which
  needs far more memory than an 8 GB Jetson has. Do not invent tiers.
- **Docs are split by audience:** `README.md` = humans, `AGENTS.md` = agents.
- **Mermaid diagrams** prefer horizontal or multi-row (`flowchart LR`) for GitHub
  readability. In docs, images use `<img width="…">` HTML tags, never bare Markdown
  `![](…)`.
- **Dependencies:** pin exact versions (no `^`/`~`) and respect the operator's minimum
  age policy for new releases.
- **`.gitignore` is folder-first.** Every rule that targets a directory ends in `/`
  (`logs/`, `dist/`, `.next/`, `.cache/`, `scripts/`). File rules and globs stay bare
  (`.env`, `*.log`, `*.db`, `*.tgz`). Add new directories as `foo/`, not `foo`.
- **Local-only, gitignored:** `scripts/`, `Skills/`, `.cf/`, `apps/api/data/`, and
  scratch files (`_tmp*`, `_tmp_*/`). Don't commit them, don't read them into docs.
- Prefer local tooling (`npx`, project venv) over global installs.

## Known rough edges (don't be surprised)

- `apps/api` returns `null` for GPU/temp metrics when it is not running on Jetson
  hardware.
- Web search returns mock results when no key is set.
- TOTP is implemented but off by default (`AUTH_REQUIRE_TOTP=false`).
- A paired board reaches Muse through the Worker gateway with its device token; an
  unpaired board with no `META_API_KEY` (dev only) falls back to local with reason
  `no_meta_key_fallback_local`.
- The Worker calls Meta through `metadesk-meta-egress`, pinned to `aws:us-east-1`:
  from some edge regions (Hong Kong) the preview API answers `model_not_found` for
  valid models. Keep the main Worker unpinned so it stays near D1 and the boards.
