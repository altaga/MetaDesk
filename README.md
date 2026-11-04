<p align="center">
  <img src="./docs/brand/metadesk-mark.svg" width="140" alt="MetaDesk Logo" />
</p>

<h1 align="center">MetaDesk</h1>

<p align="center">
  <strong>Muse, running on your hardware.</strong><br>
  An operator desk that gives Meta&apos;s Muse models a real NVIDIA Jetson to work on —
  shell, files, browser, and background jobs on the board you own.
</p>

<p align="center">
  <a href="#the-desk"><img src="https://img.shields.io/badge/Hardware-NVIDIA%20Jetson-76B900?style=flat&logo=nvidia&logoColor=white" alt="NVIDIA Jetson"></a>
  <a href="#the-muse-ladder"><img src="https://img.shields.io/badge/Meta%20AI-Muse%20Spark%20%26%20Wonder-0064E0?style=flat&logo=meta&logoColor=white" alt="Meta Muse"></a>
  <a href="#security"><img src="https://img.shields.io/badge/Relay-Cloudflare%20DO-F38020?style=flat&logo=cloudflare&logoColor=white" alt="Cloudflare Relay"></a>
  <a href="./LICENSE"><img src="https://img.shields.io/badge/License-MIT-green.svg?style=flat" alt="MIT License"></a>
</p>

<img src="./docs/screenshots/landing.png" width="900" alt="MetaDesk landing — Built on Meta Muse" />

---

## What it is

Most chat apps rent a model in a data center and leave your hardware idle. MetaDesk flips that:

1. **Muse is the brain.** Hard turns go to Meta&apos;s Muse models (`muse-spark-1.3-contributor`, `muse-spark-1.3`, `muse-wonder-1.0`) through the Meta Model API — keys stay in the Cloudflare Worker, never on the board or in the browser.
2. **The Jetson is the body.** Chat drives a real PTY, the desk workspace, a headless browser, and durable jobs **on the board**.
3. **Local processing is the filter.** A small Ollama model on the Jetson handles routing, short answers, and prompt compression for free. Muse is called when a turn needs it.
4. **No inbound ports.** The board dials out to a Cloudflare Durable Object relay, so it works behind home or lab NAT.

---

## Signing in

Operators sign in once with the credentials the board was bootstrapped with and land on the desk.

<img src="./docs/screenshots/login.png" width="520" alt="Signing in to MetaDesk" />

---

## The desk

One surface for the whole machine: conversations on the left, live Muse / local routing in the composer, and the board itself — Machine, Board telemetry, Library, Fleet — one click away.

<img src="./docs/screenshots/desk.png" width="1000" alt="MetaDesk operator console with a live conversation" />

The model sees real observations from the box, not a mock. Destructive shell, patches, and deploys wait for your approval.

---

## The Muse ladder

Every turn picks a rung before it costs anything. Leave the composer on **Auto**, or pin a tier by hand:

| Tier | Engine | Model | Job |
|---|---|---|---|
| **Local** | Ollama on the Jetson | `qwen3.5:4b` (`OLLAMA_MODEL`) | Routing, short answers, compression — free & offline |
| **Fast** | Meta Model API | `muse-spark-1.3-contributor` | Everyday coding and longer reasoning |
| **Heavy** | Meta Model API | `muse-spark-1.3` | Hard debug / deep context |
| **Ultra** | Meta Model API | `muse-wonder-1.0` | Manual / hardest turns |

```mermaid
flowchart LR
  subgraph OnBoard["On the Jetson"]
    direction TB
    Msg["Operator message"] --> Router["Hybrid router"]
    Router -->|Free| Local["Local Ollama"]
    Router -->|Hard turns| Compress["Compress history"]
  end
  subgraph Cloud["Cloud — Muse only when needed"]
    direction TB
    Compress --> Gateway["Worker gateway<br/>key custody + ledger"]
    Gateway --> Spark["muse-spark-1.3-contributor"]
    Gateway --> Wonder["muse-wonder-1.0"]
  end
  Local --> Out["Stream + route telemetry"]
  Spark --> Out
  Wonder --> Out
```

`LLM_MODE`: `hybrid` (default) · `local_only` · `cloud_only`. Cloud spend is metered in D1; the board keeps a soft daily budget.

---

## Nova, the desk guide

Nova lives in the header. She is not a second board agent: she knows the product, answers in your language, and can drive the UI (open a screen, spotlight a control). She runs on **Muse Spark** in the Worker and never runs shell or writes files.

<img src="./docs/screenshots/nova.png" width="900" alt="Nova desk guide over live board telemetry" />

---

## Machine console

The same desk flips to the board itself — files, a live shell, agents, missions, and preview. What you see and what Muse acts on are the same device.

<img src="./docs/screenshots/machine-terminal.png" width="900" alt="Live terminal on the paired Jetson" />

---

## Board telemetry

Health, host identity, and desk root come from the live device — GPU/thermals when the hardware reports them.

<img src="./docs/screenshots/board.png" width="900" alt="Board telemetry for a paired Jetson" />

---

## Fleet

Pair several boards to one account and switch which one the desk drives. Pairing is dial-out only: a USB setup wizard or a short claim code — never an exposed `:8000`.

<img src="./docs/screenshots/fleet.png" width="900" alt="Fleet view with paired boards and pairing wizard" />

---

## What the agent can do on the board

The model asks for work with fenced blocks; the board executes them behind approval and safety gates.

| Fence | Capability | Approval |
|---|---|---|
| `run` | Shell on the board | Destructive only |
| `read` / `list` | Workspace filesystem | — |
| `patch` | Single-match code edit with diff preview | **Always** |
| `search` | Web search via the Worker gateway | — |
| `install` | Vetted recipes from trusted hosts only | Trusted hosts |
| `browse` | Headless browser + screenshots | — |
| `job` | Background work that outlives the chat tab | — |
| `deploy` | Deploy recipe with rollback on failure | **Always** |

---

## Security

```mermaid
flowchart LR
  subgraph Public["Public web"]
    Browser["Operator browser"] --> Auth["Desk auth · JWT"]
  end
  subgraph CF["Cloudflare"]
    Auth --> Worker["MetaDesk Worker"]
    Worker --> Relay["DeviceRelay DO"]
    Worker --> Vault["Muse + search keys"]
  end
  subgraph Board["Your Jetson"]
    Relay <-->|"Outbound WS"| Agent["board-agent"]
    Agent --> API["FastAPI · 127.0.0.1:8000"]
  end
  Vault -.-> Meta["Meta Model API"]
```

- Secrets never leave the Worker; the board holds only a `device_token`.
- The board opens no inbound port for remote control.
- Unpaired `/setup` is USB-local only and shuts down after pairing.

Canonical detail: [docs/ARCHITECTURE.md](./docs/ARCHITECTURE.md) · [docs/API.md](./docs/API.md) · [AGENTS.md](./AGENTS.md).

---

## Repository layout

```
MetaDesk/
├── apps/
│   ├── api/            # FastAPI on the Jetson — hybrid router, chat tools, jobs
│   ├── web/            # Next.js desk UI + BFF
│   ├── cloud/          # Cloudflare Worker + D1 + DeviceRelay + Muse gateway
│   ├── board-agent/    # Outbound WebSocket agent
│   └── board-emu/      # Docker fake boards for local pairing / demos
├── docs/
│   ├── ARCHITECTURE.md
│   ├── API.md
│   ├── brand/
│   └── screenshots/
├── AGENTS.md
└── README.md
```

---

## Next step

MetaDesk today is a **general-purpose operator desk** for Jetson boards driven by Muse. The next leap is the same chat surface as a control plane for **robotic systems** — fleets of manipulators, rovers, and other edge machines — dispatched in natural language on top of this stack.

---

## Acknowledgements

Built for **Cerebral Valley & Meta AI**, powered by [Meta Muse](https://ai.meta.com/), [NVIDIA Jetson](https://www.nvidia.com/en-us/autonomous-machines/embedded-systems/), [Cloudflare Workers](https://workers.cloudflare.com/), and [Ollama](https://ollama.ai/).

## License

MIT — see [LICENSE](./LICENSE).
