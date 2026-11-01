# board-emu

Emulated MetaDesk boards in Docker: the board API and the board agent in one
container, cloud-only (no local model). Each one boots **unpaired**, exactly like a
fresh Jetson, so the desk's *Set up a board* wizard can discover and enroll it.

```bash
cd apps/board-emu
# Compose needs your Worker; put it in apps/board-emu/.env (git-ignored).
echo 'METADESK_CLOUD_URL=https://metadesk-cloud.<your-subdomain>.workers.dev' > .env
docker compose up -d --build emu-1
```

Then open the desk (production is fine) → **Fleet → Set up a board**. The first time,
the browser asks to allow **access to devices on your local network**; allow it. The
wizard finds `Jetson#XXX` on `127.0.0.1:18101`, you set a name, a password and Wi-Fi
(saved, not applied), confirm the Pair ID, and the board joins the fleet and dials the
relay.

| Board | Host port |
|---|---|
| `emu-1` | `127.0.0.1:18101` |
| `emu-2` | `127.0.0.1:18102` |
| `emu-3` | `127.0.0.1:18103` |

- Ports are published on the host's loopback only, never on the LAN.
- Each board keeps its identity, data and per-board secrets in a named volume, so it
  stays paired across restarts. `docker compose down -v` forgets them; they come back
  unpaired.
- Point a board at another Worker with `METADESK_CLOUD_URL=…` (for example a local
  `wrangler dev` reached through `http://host.docker.internal:8787`).
