<p align="center">
  <img src="./docs/brand/metadesk-mark.svg" width="140" alt="MetaDesk Logo" />
</p>

<h1 align="center">MetaDesk</h1>

<p align="center">
  <strong>Talk to Edge Hardware. Command Robot Fleets.</strong><br>
  An embodied AI operator desk whose brain lives on physical edge hardware — transforming NVIDIA Jetsons into chat-driven robotic swarms.
</p>

<p align="center">
  <a href="#the-10-second-tldr"><img src="https://img.shields.io/badge/Hardware-NVIDIA%20Jetson%20Orin-76B900?style=flat&logo=nvidia&logoColor=white" alt="NVIDIA Jetson"></a>
  <a href="#the-model-ladder"><img src="https://img.shields.io/badge/Meta%20AI-Muse%20Spark%20%26%20Wonder-0064E0?style=flat&logo=meta&logoColor=white" alt="Meta Muse"></a>
  <a href="#hybrid-edge-cloud-architecture"><img src="https://img.shields.io/badge/Local%20LLM-Ollama%20GPU-FF6B6B?style=flat" alt="Ollama Local"></a>
  <a href="#security--zero-inbound-ports"><img src="https://img.shields.io/badge/Relay-Cloudflare%20DO%20(No%20Open%20Ports)-F38020?style=flat&logo=cloudflare&logoColor=white" alt="Cloudflare Relay"></a>
  <a href="#the-grand-vision-from-edge-agents-to-robot-fleets"><img src="https://img.shields.io/badge/Vision-Embodied%20Robot%20Fleets-8A2BE2?style=flat" alt="Robot Fleets"></a>
  <a href="./LICENSE"><img src="https://img.shields.io/badge/License-MIT-green.svg?style=flat" alt="MIT License"></a>
</p>

---

## ⚡ The 10-Second TL;DR

> **Why did we build MetaDesk?**<br>
> Most AI agents live trapped in cloud data centers with no eyes, no hands, and zero physical presence. Meanwhile, millions of developer boards and robotics kits sit idling on desks.<br>
> **MetaDesk gives AI a physical body and an edge brain.**

1. **Physical Edge Brain:** The agent lives on your **NVIDIA Jetson** (with Arduino / robotic arm hardware tie-ins). It's not a generic web chatbot—it directly controls the shell, files, GPIOs, cameras, and robotic actuators.
2. **Hybrid Intelligence Ladder:** A fast local GPU model (Ollama) answers routine queries for free, inspects hardware, and compresses context on-device. When complex spatial reasoning or heavy architecture is required, it routes out to **Meta's Muse models** (`muse-spark-1.3`, `muse-wonder-1.0`).
3. **Zero-Trust Outbound Relay:** The edge device dials **out** to a Cloudflare Durable Object relay. You can control your hardware from anywhere in the world behind home or lab NAT without opening a single inbound port.
4. **The Big Vision — Robot Fleets via Chat:** Jetson is the industry standard for robotics. MetaDesk is evolving from a single developer desk into a **unified conversational control plane for fleets of autonomous robots** (manipulator arms, rovers, and edge drones).

---

## 🚀 The Grand Vision: From Edge Agents to Robot Fleets

The physical edge is where AI meets the real world. MetaDesk is intentionally architected in two complementary phases:

```mermaid
flowchart LR
  subgraph Phase1["PHASE 1 (Live Today): Remote Hardware Agent"]
    direction TB
    P1A["Developer Chat Desk"] --> P1B["Jetson GPU Local Router"]
    P1B --> P1C["Actuator & Serial Drivers (Robotic Arms)"]
    P1B --> P1D["Frontier Meta Muse Reasoning"]
  end

  subgraph Phase2["PHASE 2 (The Fleet Vision): Autonomous Robotic Swarms"]
    direction TB
    P2A["Multi-Board Fleet Console"] --> P2B["Natural Language Task Dispatch"]
    P2B --> P2C["Unit 01: Armic Manipulator (Sorting)"]
    P2B --> P2D["Unit 02: Jetson Rover (Inspection)"]
    P2B --> P2E["Collaborative Swarm Telemetry"]
  end

  Phase1 ==>|Scales into| Phase2
```

### Phase 1: The Remote Hardware Agent (Active Today)
* **Embodied Execution:** The model inspects real GPU thermals, disk IO, cameras, serial buses, and connected hardware.
* **Safety Fences & Human Brakes:** Hardware commands, code patches, and actuator movements pass through explicit safety gates and physical kinematic interlocks before execution.
* **Cost-Controlled Edge Inference:** The GPU on your desk becomes your cost control plane. Over 70% of routine queries, telemetry polls, and history compression run completely free on local silicon.

### Phase 2: Autonomous Robot Fleets Controllable by Chat (The Next Leap)
* **Why NVIDIA Jetson?** NVIDIA Jetson is the gold-standard compute module for autonomous machines worldwide. By building MetaDesk on Jetson, every connected board is a potential autonomous robot.
* **Conversational Fleet Dispatch:** Instead of writing low-level ROS2 nodes or manual joystick routines, operators simply talk to their fleet:
  > *"Nova, have Armic Arm Unit 01 pick and sort the microcontrollers on tray A, while Rover Unit 02 conducts an autonomous thermal sweep of Sector 4."*
* **Distributed Swarm Coordination:** The Cloudflare Durable Object relay aggregates fleet status in real-time, allowing swarms of heterogeneous edge robots to coordinate, share spatial memory, and execute multi-agent physical workflows safely.

---

## 🧠 The Hybrid Model Ladder

Most AI applications blindly beam every keystroke to expensive cloud APIs. MetaDesk treats the Jetson GPU as an **intelligent cost filter and compression engine**:

```mermaid
flowchart LR
  subgraph OnBoard["On the Jetson Board"]
    direction TB
    Msg["Operator Prompt"] --> Router["Hybrid Router<br/>(Rules + Local Selector)"]
    Router -->|Free / Fast| Local["Local Ollama GPU<br/>(qwen3.5:4b)"]
    Router -->|Hard Reasoning| Compress["Prompt Compression<br/>(Shrink history on-device)"]
  end

  subgraph CloudPlane["Cloud Plane (Only when needed)"]
    direction TB
    Compress --> Gateway["Desk Gateway<br/>(Key Custody + Ledger)"]
    Gateway --> MetaSpark["Meta muse-spark-1.3<br/>(Fast Q&A, Summaries)"]
    Gateway --> MetaWonder["Meta muse-wonder-1.0<br/>(1M Context, Heavy Reasoning)"]
  end

  subgraph Output["Unified Stream"]
    Local --> Result["Answer + Cost Savings Telemetry"]
    MetaSpark --> Result
    MetaWonder --> Result
  end
```

### The Tier Hierarchy

| Tier | Engine | Model | Purpose & Workload |
|---|---|---|---|
| **`local`** | Local Jetson GPU (Ollama) | `qwen3.5:4b` (`OLLAMA_MODEL`) | **100% Free & On-Device.** Greetings, intent routing, format conversion, hardware telemetry polling, and prompt history compression. |
| **`fast`** | Meta Model API | `muse-spark-1.3` | **Low Latency Cloud.** General engineering Q&A, code analysis, fast summaries, and live interactive guidance. |
| **`heavy`** | Meta Model API | `muse-wonder-1.0` | **Frontier Agentic Reasoning.** 1M-token context window, multi-file code refactors, complex kinematics planning, and deep system debugging. |
| **`ultra`** | Meta Model API | `muse-wonder-full-1.0` | **Maximum Compute.** Reserved for high-complexity architectural synthesis (manual selection only). |

Leave the router on `Auto` to let the Jetson pick the most economical capable tier per turn, or manually pin a specific tier in the desk composer.

---

## 🦾 Real Hardware Actuation: The Armic Proof-of-Concept

MetaDesk doesn't just read mock files—it physically interacts with microcontrollers and mechanical robots.

Included in the architecture is a dedicated standalone **Serial Actuator Subsystem** for 4DOF robotic arms (e.g., Arduino UNO Q + Adafruit PCA9685 PWM servos):
* **Kinematics with Physical Interlocks:** Firmware-enforced S-curve acceleration curves and strict angle boundaries (e.g., Elbow mechanically locked to $\ge 90.0^\circ$ to prevent physical gear stripping).
* **Direct Hardware Fences:** Chat commands automatically translate into validated serial packets over USB CDC (`COM8` / `/dev/ttyGS0`).
* **Emergency Stop (`ESTOP`):** Instant de-energizing of motor PWM lines via hardware override.

```
Operator Chat: "Gently pick up the component at coordinates X:120 Y:45 Z:10"
      │
      ▼
MetaDesk Hybrid Router (Validates kinematics + safety bounds)
      │
      ▼
Outbound Serial Frame: "JOINTS 90.0 110.0 95.0 45.0" -> S-Curve Servo Trajectory
```

---

## 🛠️ What the Agent Can Do on the Board

The model emits structured, fenced action blocks that run natively on the Jetson inside security containers:

| Tool Fence | Capability | Approval Gate |
|---|---|---|
| `run` | Execute shell commands on the board (secrets automatically injected, never printed) | **Destructive only** |
| `read` / `list` | Inspect workspace filesystem, configs, and directory structures | Automatic |
| `patch` | Precision single-match code edits with diff preview | **Always required** |
| `health` | Instant snapshot of Jetson GPU, RAM, thermals, and disk usage | Automatic |
| `install` | Safe package installation with verified registry checks (prevents `curl\|bash` exploits) | Vetted hosts only |
| `browse` | On-board headless browser execution with screenshot capture | Automatic |
| `record` | Record automated video walkthroughs of running web apps on the board | Automatic |
| `verify` | Execute automated test harnesses (`verify.json`) | Automatic |
| `job` | Long-running background daemon tasks that survive browser tab closure | Automatic |
| `deploy` | Atomic deployment recipes with automatic rollback on test failure | **Always required** |

---

## 👩‍🚀 Nova: Your On-Screen AI Desk Guide

<p align="center">
  <em>Nova lives in the desk sidebar. She is not a separate chat persona—she is an embodied assistant that drives the UI for you.</em>
</p>

* **Interactive Tour:** Click *Take the tour* and Nova walks you through all 7 areas of the desk (Chat, Model Ladder, Terminal, File Tree, Telemetry, Vault, and Fleet Pairing), dynamically highlighting each button and switch as she explains it.
* **Zero Cost:** The guided tour runs locally without spending a single API token.
* **Strictly Guarded:** Powered by `muse-spark-1.3`, Nova can navigate the interface and explain features, but cannot execute arbitrary shell commands or overwrite files without operator authorization.

---

## 🔒 Security: Zero Inbound Ports, Zero Leaked Keys

```mermaid
flowchart LR
  subgraph PublicWeb["Public Web"]
    Browser["Operator Browser<br/>(Desk UI)"] --> Auth["Desk Auth<br/>(JWT + TOTP)"]
  end

  subgraph Cloudflare["Cloudflare Edge Plane"]
    Auth --> Worker["MetaDesk Worker"]
    Worker --> DO["DeviceRelay<br/>(Durable Object)"]
    Worker --> Vault["Secret Vault<br/>(Meta API Key stays here)"]
  end

  subgraph PrivateLAN["Home / Lab Private LAN (Behind NAT)"]
    DO <-->|"Outbound-Only WebSocket<br/>(/v1/agent/connect)"| BoardAgent["board-agent"]
    BoardAgent --> JetsonAPI["Jetson FastAPI<br/>(127.0.0.1:8000)"]
  end

  Vault -.->|"Injected on egress"| MetaAPI["Meta Model API"]
```

1. **No Inbound Ports on the Jetson:** The board initiates an **outbound** persistent WebSocket connection to the Cloudflare Durable Object relay. You never have to port-forward, configure dynamic DNS, or expose port 8000 to the public internet.
2. **Secrets Never Leave the Cloud Gateway:** The Meta Model API key resides exclusively inside Cloudflare Worker secrets. The Jetson board holds only a scoped `device_token`.
3. **Hardware Claim Code Pairing:** Pairing a new Jetson to your fleet takes 10 seconds via a 6-digit claim code over a local USB gadget link or local network handshake.

---

## 📂 Repository Layout

```
MetaDesk/
├── apps/
│   ├── api/            # FastAPI on Jetson: router, chat tools, hardware CLI, jobs
│   ├── web/            # Next.js 14 desk UI: real-time streaming, telemetry, fleet view
│   ├── cloud/          # Cloudflare Worker + D1 + Durable Object relay + Meta gateway
│   ├── board-agent/    # Outbound-WS daemon on the board proxying cloud to local API
│   └── board-emu/      # Docker-based emulated Jetson boards for instant local testing
├── docs/
│   ├── ARCHITECTURE.md # Exhaustive system architecture, routing logic & security
│   ├── API.md          # Complete REST, WebSocket & RPC contract specifications
│   └── brand/          # Vector assets and design guidelines
├── armic_serial.py     # Turnkey serial driver & CLI for 4DOF robotic arm actuators
├── AGENTS.md           # Machine-facing orientation and invariants for AI agents
└── README.md           # You are here
```

---

## ⚡ Quickstart: Try It in 3 Minutes

You don't need a physical Jetson on hand to evaluate MetaDesk! You can run our Dockerized `board-emu` immediately on your laptop:

### 1. Clone & Install Dependencies
```bash
git clone https://github.com/altaga/MetaDesk.git
cd MetaDesk

npm run install:web
npm run install:api
```

### 2. Configure Environment
```bash
cp secrets.env.example secrets.env
# Add your Cloudflare credentials or META_API_KEY if testing cloud tiers
```

### 3. Spin Up the Desk & Emulated Board
```bash
# Terminal 1: Launch Local API & Board
npm run dev:api

# Terminal 2: Launch Next.js Web Desk
npm run dev:web
```
Open **[http://localhost:3000](http://localhost:3000)** in your browser. Log in, take the guided tour with Nova, and watch the hybrid ladder route queries in real-time!

---

## 👥 Hackathon Team & Acknowledgements

Built with passion for **Cerebral Valley & Meta AI**:
* **Architecture & Edge AI:** MetaDesk Team
* **Powered by:** [Meta Muse Models](https://ai.meta.com/) (`muse-spark-1.3`, `muse-wonder-1.0`), [NVIDIA Jetson](https://www.nvidia.com/en-us/autonomous-machines/embedded-systems/), [Cloudflare Workers](https://workers.cloudflare.com/), and [Ollama](https://ollama.ai/).

---

## 📄 License

This project is licensed under the **MIT License** — see the [LICENSE](./LICENSE) file for details.
