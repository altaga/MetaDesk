import { requireUser } from "../auth/guard";
import { randomToken, sha256Hex } from "../crypto";
import { DeviceRow, ownedDevice, requireDevice } from "../devices/service";
import { Env, nowSec } from "../env";
import { HttpError, json } from "../http";
import { Router } from "../router";
import { FORWARD_REQUEST_HEADERS, RelayUser } from "./protocol";

const TICKET_TTL_SEC = 60;
const RETRY_STATUSES = new Set([502, 503]);
const RETRY_WAIT_MS = 1200;

function relayFor(env: Env, deviceId: string): DurableObjectStub {
  return env.RELAY.get(env.RELAY.idFromName(deviceId));
}

function requireUpgrade(req: Request): void {
  if (req.headers.get("upgrade")?.toLowerCase() !== "websocket") throw new HttpError(426, "websocket_required");
}

function requireRemote(device: DeviceRow): void {
  if (!device.remote_enabled) throw new HttpError(423, "remote_disabled");
}

export function relayRoutes(router: Router<Env>): void {
  /** The board dials in here and keeps the socket open. */
  router.get("/v1/agent/connect", async (req, env) => {
    requireUpgrade(req);
    const device = await requireDevice(req, env);
    return relayFor(env, device.id).fetch("https://relay/agent", {
      headers: { upgrade: "websocket", "x-device-id": device.id },
    });
  });

  router.post("/v1/devices/:id/terminal-ticket", async (req, env, _ctx, { id }) => {
    const user = await requireUser(req, env);
    requireRemote(await ownedDevice(env, user.id, id));
    const ticket = randomToken();
    await env.DB.prepare("INSERT INTO terminal_tickets (ticket_hash, user_id, device_id, expires_at) VALUES (?1, ?2, ?3, ?4)")
      .bind(await sha256Hex(ticket), user.id, id, nowSec() + TICKET_TTL_SEC)
      .run();
    const url = new URL(req.url);
    return json({
      ws_url: `wss://${url.host}/v1/terminal?ticket=${encodeURIComponent(ticket)}`,
      expires_in: TICKET_TTL_SEC,
    });
  });

  /** Browsers open terminals directly here with a single-use ticket. */
  router.get("/v1/terminal", async (req, env) => {
    requireUpgrade(req);
    const url = new URL(req.url);
    const ticket = url.searchParams.get("ticket") || "";
    const row = await env.DB.prepare(
      "DELETE FROM terminal_tickets WHERE ticket_hash = ?1 RETURNING user_id, device_id, expires_at"
    )
      .bind(await sha256Hex(ticket))
      .first<{ user_id: number; device_id: string; expires_at: number }>();
    if (!row || row.expires_at < nowSec()) throw new HttpError(401, "invalid_ticket");
    const user = await env.DB.prepare("SELECT id, username FROM users WHERE id = ?1").bind(row.user_id).first<RelayUser>();
    if (!user) throw new HttpError(401, "invalid_ticket");
    requireRemote(await ownedDevice(env, user.id, row.device_id));
    return relayFor(env, row.device_id).fetch("https://relay/terminal", {
      headers: {
        upgrade: "websocket",
        "x-user": JSON.stringify({ id: user.id, username: user.username }),
        "x-cols": url.searchParams.get("cols") || "100",
        "x-rows": url.searchParams.get("rows") || "30",
      },
    });
  });

  /** Everything under the board's own API, streamed through its socket. */
  router.any("/v1/devices/:id/*", async (req, env, _ctx, { id, rest }) => {
    const user = await requireUser(req, env);
    requireRemote(await ownedDevice(env, user.id, id));
    const first = await forwardToBoard(env, id, req, rest, user);
    if (!safeToRetry(req.method) || !RETRY_STATUSES.has(first.status)) return first;
    await first.body?.cancel().catch(() => undefined);
    await new Promise((resolve) => setTimeout(resolve, RETRY_WAIT_MS));
    return forwardToBoard(env, id, req, rest, user);
  });
}

function safeToRetry(method: string): boolean {
  return method === "GET" || method === "HEAD";
}

function forwardHeaders(req: Request): Record<string, string> {
  const forward: Record<string, string> = {};
  for (const name of FORWARD_REQUEST_HEADERS) {
    const value = req.headers.get(name);
    if (value) forward[name] = value;
  }
  return forward;
}

function forwardToBoard(env: Env, id: string, req: Request, rest: string, user: RelayUser): Promise<Response> {
  const search = new URL(req.url).search;
  return relayFor(env, id).fetch("https://relay/proxy", {
    method: req.method,
    body: safeToRetry(req.method) ? undefined : req.body,
    headers: {
      "x-path": `/${rest}${search}`,
      "x-user": JSON.stringify(user),
      "x-forward-headers": JSON.stringify(forwardHeaders(req)),
    },
  });
}
