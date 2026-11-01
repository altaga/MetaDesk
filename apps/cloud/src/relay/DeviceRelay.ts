import { DurableObject } from "cloudflare:workers";
import { markBoardHello, markPresence } from "../devices/service";
import { Env, nowSec } from "../env";
import { json } from "../http";
import { recordOpsEvent } from "../ops/service";
import {
  FromAgent,
  FromTerminal,
  MAX_REQUEST_BODY,
  RelayUser,
  RESPONSE_START_TIMEOUT_MS,
  ToAgent,
} from "./protocol";

type Head = { status: number; headers: Record<string, string> };

type Pending = {
  writer: WritableStreamDefaultWriter<Uint8Array>;
  start: (head: Head) => void;
  fail: (reason: string) => void;
  started: boolean;
};

const AGENT = "agent";
const TERM = "term";
const termTag = (sid: string) => `term:${sid}`;

/** One per board. Holds the board's socket and bridges HTTP and terminals onto it. */
export class DeviceRelay extends DurableObject<Env> {
  private pending = new Map<string, Pending>();

  constructor(ctx: DurableObjectState, env: Env) {
    super(ctx, env);
    ctx.setWebSocketAutoResponse(new WebSocketRequestResponsePair("ping", "pong"));
  }

  async fetch(req: Request): Promise<Response> {
    const { pathname } = new URL(req.url);
    if (pathname === "/agent") return this.acceptAgent(req);
    if (pathname === "/terminal") return this.acceptTerminal(req);
    if (pathname === "/proxy") return this.proxy(req);
    if (pathname === "/status") return json({ online: Boolean(this.agent()) });
    return json({ detail: { error: "not_found" } }, 404);
  }

  private agent(): WebSocket | null {
    return this.ctx.getWebSockets(AGENT).find((ws) => ws.readyState === WebSocket.OPEN) ?? null;
  }

  /** A failed send means the socket is half-open. Close it so the board dials back. */
  private send(ws: WebSocket, frame: ToAgent): boolean {
    try {
      ws.send(JSON.stringify(frame));
      return true;
    } catch {
      try {
        ws.close(1011, "send failed");
      } catch {
        /* The runtime already dropped this socket. */
      }
      return false;
    }
  }

  private failAll(reason: string): void {
    for (const [id, pending] of this.pending) {
      this.pending.delete(id);
      if (!pending.started) pending.fail(reason);
      pending.writer.abort(reason).catch(() => undefined);
    }
  }

  private async acceptAgent(req: Request): Promise<Response> {
    const deviceId = req.headers.get("x-device-id") || "";
    this.failAll("board_reconnecting");
    for (const old of this.ctx.getWebSockets(AGENT)) old.close(4000, "replaced");
    const { 0: client, 1: server } = new WebSocketPair();
    this.ctx.acceptWebSocket(server, [AGENT]);
    await this.ctx.storage.put("device_id", deviceId);
    return new Response(null, { status: 101, webSocket: client });
  }

  private acceptTerminal(req: Request): Response {
    const agent = this.agent();
    if (!agent) return json({ detail: { error: "board_offline" } }, 503);
    const user = JSON.parse(req.headers.get("x-user") || "{}") as RelayUser;
    const cols = Number(req.headers.get("x-cols")) || 100;
    const rows = Number(req.headers.get("x-rows")) || 30;
    const sid = crypto.randomUUID();
    const { 0: client, 1: server } = new WebSocketPair();
    this.ctx.acceptWebSocket(server, [TERM, termTag(sid)]);
    this.send(agent, { t: "term_open", sid, cols, rows, user });
    return new Response(null, { status: 101, webSocket: client });
  }

  private async proxy(req: Request): Promise<Response> {
    const t0 = Date.now();
    const path = req.headers.get("x-path") || "/";
    const user = JSON.parse(req.headers.get("x-user") || "{}") as RelayUser;
    const deviceId = (await this.ctx.storage.get<string>("device_id")) || "";

    const agent = this.agent();
    if (!agent) {
      await this.logRelayError("board_offline", path, deviceId, user, t0);
      return json({ detail: { error: "board_offline" } }, 503);
    }
    const raw = req.method === "GET" || req.method === "HEAD" ? null : await req.arrayBuffer();
    if (raw && raw.byteLength > MAX_REQUEST_BODY) {
      await this.logRelayError("body_too_large", path, deviceId, user, t0);
      return json({ detail: { error: "body_too_large" } }, 413);
    }

    const id = crypto.randomUUID();
    const { readable, writable } = new TransformStream<Uint8Array, Uint8Array>();
    const head = new Promise<Head>((resolve, reject) => {
      const timer = setTimeout(() => reject(new Error("board_timeout")), RESPONSE_START_TIMEOUT_MS);
      this.pending.set(id, {
        writer: writable.getWriter(),
        started: false,
        start: (h) => {
          clearTimeout(timer);
          resolve(h);
        },
        fail: (reason) => {
          clearTimeout(timer);
          reject(new Error(reason));
        },
      });
    });

    const sent = this.send(agent, {
      t: "req",
      id,
      method: req.method,
      path,
      headers: JSON.parse(req.headers.get("x-forward-headers") || "{}"),
      user,
      body: raw && raw.byteLength ? Buffer.from(raw).toString("base64") : undefined,
    });
    if (!sent) this.pending.get(id)?.fail("board_offline");

    try {
      const { status, headers } = await head;
      return new Response(readable, { status, headers });
    } catch (err) {
      this.pending.delete(id);
      const reason = err instanceof Error ? err.message : "board_error";
      await this.logRelayError(reason, path, deviceId, user, t0);
      return json({ detail: { error: reason } }, reason === "board_timeout" ? 504 : 502);
    }
  }

  private async logRelayError(
    errorCode: string,
    path: string,
    deviceId: string,
    user: RelayUser,
    t0: number
  ): Promise<void> {
    // Skip noisy polls; keep chat/guide/shell/file link failures.
    if (!/\/api\/(chat|guide|cli|files)\b/.test(path)) return;
    await recordOpsEvent(this.env, {
      kind: "relay",
      status: "error",
      error_code: errorCode,
      user_id: typeof user.id === "number" ? user.id : null,
      username: typeof user.username === "string" ? user.username : null,
      device_id: deviceId || null,
      path: path.slice(0, 200),
      latency_ms: Date.now() - t0,
      features: { hop: "relay" },
      note: "board_link",
    });
  }

  async webSocketMessage(ws: WebSocket, message: string | ArrayBuffer): Promise<void> {
    const text = typeof message === "string" ? message : new TextDecoder().decode(message);
    const tags = this.ctx.getTags(ws);
    if (tags.includes(AGENT)) return this.onAgentFrame(ws, JSON.parse(text) as FromAgent);
    const sid = tags.find((t) => t.startsWith("term:"))?.slice(5);
    if (sid) this.onTerminalFrame(sid, JSON.parse(text) as FromTerminal);
  }

  private async onAgentFrame(ws: WebSocket, frame: FromAgent): Promise<void> {
    switch (frame.t) {
      case "res": {
        const p = this.pending.get(frame.id);
        if (p && !p.started) {
          p.started = true;
          p.start({ status: frame.status, headers: frame.headers });
        }
        return;
      }
      case "chunk": {
        const p = this.pending.get(frame.id);
        p?.writer.write(Buffer.from(frame.b64, "base64")).catch(() => this.cancel(frame.id));
        return;
      }
      case "end": {
        const p = this.pending.get(frame.id);
        if (!p) return;
        this.pending.delete(frame.id);
        if (!p.started) p.fail(frame.error || "board_error");
        (frame.error ? p.writer.abort(frame.error) : p.writer.close()).catch(() => undefined);
        return;
      }
      case "term_out":
        for (const ws of this.ctx.getWebSockets(termTag(frame.sid))) ws.send(Buffer.from(frame.b64, "base64"));
        return;
      case "term_exit":
        for (const ws of this.ctx.getWebSockets(termTag(frame.sid))) ws.close(1000, "exited");
        return;
      case "hello": {
        const deviceId = await this.ctx.storage.get<string>("device_id");
        if (deviceId) {
          try {
            await markPresence(this.env, deviceId, true, nowSec());
            const host = typeof frame.hostname === "string" ? frame.hostname : null;
            await markBoardHello(this.env, deviceId, {
              hostname: host,
              boardEmu: Boolean(frame.board_emu),
            });
          } catch {
            // Presence/metadata must not tear down the board socket.
          }
        }
        this.send(ws, { t: "hello_ack" });
        return;
      }
      case "beat":
        this.send(ws, { t: "beat_ack" });
        return;
    }
  }

  private onTerminalFrame(sid: string, frame: FromTerminal): void {
    const agent = this.agent();
    if (!agent) return;
    if (frame.type === "input" && typeof frame.data === "string") {
      this.send(agent, { t: "term_in", sid, data: frame.data });
    } else if (frame.type === "resize") {
      this.send(agent, { t: "term_resize", sid, cols: frame.cols, rows: frame.rows });
    }
  }

  private cancel(id: string): void {
    if (!this.pending.delete(id)) return;
    const agent = this.agent();
    if (agent) this.send(agent, { t: "cancel", id });
  }

  async webSocketClose(ws: WebSocket): Promise<void> {
    const tags = this.ctx.getTags(ws);
    if (tags.includes(AGENT)) return this.onAgentGone(ws);
    const sid = tags.find((t) => t.startsWith("term:"))?.slice(5);
    const agent = this.agent();
    if (sid && agent) this.send(agent, { t: "term_close", sid });
  }

  async webSocketError(ws: WebSocket): Promise<void> {
    await this.webSocketClose(ws);
  }

  private async onAgentGone(closed: WebSocket): Promise<void> {
    const stillUp = this.ctx.getWebSockets(AGENT).some((ws) => ws !== closed && ws.readyState === WebSocket.OPEN);
    if (stillUp) return;
    for (const [id, p] of this.pending) {
      this.pending.delete(id);
      if (!p.started) p.fail("board_offline");
      p.writer.abort("board_offline").catch(() => undefined);
    }
    for (const ws of this.ctx.getWebSockets(TERM)) ws.close(1011, "board offline");
    const deviceId = await this.ctx.storage.get<string>("device_id");
    if (deviceId) await markPresence(this.env, deviceId, false, nowSec());
  }
}
