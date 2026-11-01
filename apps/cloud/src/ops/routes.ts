import { requireUser } from "../auth/guard";
import { requireDevice } from "../devices/service";
import { Env } from "../env";
import { HttpError, json, ok, readJson, str } from "../http";
import { rateLimit } from "../ratelimit";
import { Router } from "../router";
import {
  isBootstrapAdmin,
  listOpsEvents,
  presentAdmin,
  recordOpsEvent,
  redactForUser,
  usernameFor,
  type OpsKind,
  type OpsStatus,
} from "./service";

function requireAdmin(env: Env, username: string): void {
  if (!isBootstrapAdmin(env, username)) throw new HttpError(403, "admin_only");
}

function asKind(value: unknown): OpsKind {
  const k = typeof value === "string" ? value : "";
  if (k === "guide" || k === "chat" || k === "gateway" || k === "relay" || k === "search" || k === "tool") {
    return k;
  }
  throw new HttpError(422, "invalid_field", { field: "kind" });
}

function asStatus(value: unknown): OpsStatus {
  if (value === "ok" || value === "error" || value === "skipped" || value === "partial") return value;
  throw new HttpError(422, "invalid_field", { field: "status" });
}

function mapIngestBody(
  body: Record<string, unknown>,
  base: { user_id: number; username: string | null; device_id?: string | null }
) {
  return {
    kind: asKind(body.kind),
    status: asStatus(body.status),
    error_code: typeof body.error_code === "string" ? body.error_code.slice(0, 200) : null,
    user_id: base.user_id,
    username: base.username,
    device_id: base.device_id ?? (typeof body.device_id === "string" ? body.device_id.slice(0, 80) : null),
    session_id: typeof body.session_id === "string" ? body.session_id.slice(0, 80) : null,
    trace_id: typeof body.trace_id === "string" ? body.trace_id.slice(0, 80) : null,
    phase: typeof body.phase === "string" ? body.phase.slice(0, 40) : null,
    route: typeof body.route === "string" ? body.route.slice(0, 40) : null,
    model: typeof body.model === "string" ? body.model.slice(0, 120) : null,
    intent: typeof body.intent === "string" ? body.intent.slice(0, 80) : null,
    latency_ms: typeof body.latency_ms === "number" ? Math.round(body.latency_ms) : null,
    prompt_tokens: Number(body.prompt_tokens) || 0,
    completion_tokens: Number(body.completion_tokens) || 0,
    cost_usd: Number(body.cost_usd) || 0,
    path: typeof body.path === "string" ? body.path.slice(0, 200) : null,
    features: body.features && typeof body.features === "object" ? (body.features as Record<string, unknown>) : null,
    input_text: typeof body.input_text === "string" ? body.input_text : null,
    output_text: typeof body.output_text === "string" ? body.output_text : null,
    note: typeof body.note === "string" ? body.note.slice(0, 300) : null,
  };
}

/** Admin read + device/user ingest for board chat turns + Nova apply. */
export function opsRoutes(router: Router<Env>): void {
  router.get("/v1/ops/events", async (req, env) => {
    const user = await requireUser(req, env);
    requireAdmin(env, user.username);
    const url = new URL(req.url);
    const kind = url.searchParams.get("kind") || undefined;
    const status = url.searchParams.get("status") || undefined;
    const trace_id = url.searchParams.get("trace_id") || undefined;
    const device_id = url.searchParams.get("device_id") || undefined;
    const limit = Number(url.searchParams.get("limit") || 50);
    const hours = Number(url.searchParams.get("hours") || 0);
    const since = hours > 0 ? Math.floor(Date.now() / 1000) - Math.floor(hours * 3600) : undefined;
    const rows = await listOpsEvents(env, { kind, status, trace_id, device_id, limit, since_sec: since });
    return json({
      count: rows.length,
      privacy_note: "Admin lens: bootstrap rows may include I/O. Others never store prompts.",
      events: rows.map(presentAdmin),
    });
  });

  /** Admin: one trace timeline (guide + tools + chat). */
  router.get("/v1/ops/traces/:trace_id", async (req, env, _ctx, { trace_id }) => {
    const user = await requireUser(req, env);
    requireAdmin(env, user.username);
    const rows = await listOpsEvents(env, { trace_id, limit: 200 });
    rows.sort((a, b) => a.id - b.id);
    return ok(
      {
        trace_id,
        count: rows.length,
        events: rows.map(presentAdmin),
        summary: summarizeTrace(rows),
      },
      { lane: "ops" }
    );
  });

  /** User: privacy-safe failure list only. */
  router.get("/v1/ops/me/failures", async (req, env) => {
    const user = await requireUser(req, env);
    const url = new URL(req.url);
    const limit = Number(url.searchParams.get("limit") || 20);
    const hours = Number(url.searchParams.get("hours") || 168);
    const since = Math.floor(Date.now() / 1000) - Math.floor(hours * 3600);
    const rows = await listOpsEvents(env, {
      user_id: user.id,
      errors_only: true,
      limit,
      since_sec: since,
    });
    return ok(
      {
        count: rows.length,
        failures: rows.map(redactForUser),
      },
      { lane: "ops" }
    );
  });

  /** Boards push chat/tool ops with the device token. Cloud applies privacy. */
  router.post("/v1/ops/ingest", async (req, env) => {
    const device = await requireDevice(req, env);
    await rateLimit(env.DB, `ops-ingest:${device.id}`, 240, 60);
    const body = await readJson(req, 80_000);
    const username = await usernameFor(env, device.user_id);
    const event = mapIngestBody(body, { user_id: device.user_id, username, device_id: device.id });
    await recordOpsEvent(env, event);
    return json({ ok: true, privacy: isBootstrapAdmin(env, username) ? "full" : "redacted", trace_id: event.trace_id });
  });

  /**
   * Web reports Nova guide.apply (what UI actions ran/failed).
   * User JWT — never accepts input_text/output_text from the browser.
   */
  router.post("/v1/ops/guide-apply", async (req, env) => {
    const user = await requireUser(req, env);
    await rateLimit(env.DB, `ops-guide:${user.id}`, 120, 60);
    const body = await readJson(req, 40_000);
    const actions = Array.isArray(body.actions) ? body.actions.slice(0, 20) : [];
    const normalized = actions
      .map((item) => {
        if (!item || typeof item !== "object") return null;
        const row = item as Record<string, unknown>;
        const type = typeof row.type === "string" ? row.type.slice(0, 40) : "";
        if (!type) return null;
        return {
          type,
          target: typeof row.target === "string" ? row.target.slice(0, 80) : undefined,
          board: typeof row.board === "string" ? row.board.slice(0, 64) : undefined,
          emotion: typeof row.emotion === "string" ? row.emotion.slice(0, 40) : undefined,
          status: typeof row.status === "string" ? row.status.slice(0, 20) : "applied",
          reason: typeof row.reason === "string" ? row.reason.slice(0, 80) : undefined,
        };
      })
      .filter(Boolean);
    const failed = normalized.filter((a) => a && a.status !== "applied").length;
    await recordOpsEvent(env, {
      kind: "guide",
      status: failed ? "partial" : "ok",
      phase: "apply",
      user_id: user.id,
      username: user.username,
      device_id: typeof body.device_id === "string" ? body.device_id.slice(0, 80) : null,
      session_id: typeof body.session_id === "string" ? body.session_id.slice(0, 80) : null,
      trace_id: typeof body.trace_id === "string" ? body.trace_id.slice(0, 80) : null,
      features: {
        actions: normalized,
        action_types: normalized.map((a) => a!.type),
        applied: normalized.filter((a) => a!.status === "applied").length,
        rejected: failed,
      },
      // Browser must not ship spoken text — privacy.
      input_text: null,
      output_text: null,
      note: failed ? `${failed} action(s) rejected` : null,
    });
    return json({ ok: true, privacy: "redacted" });
  });

  router.post("/v1/ops/note", async (req, env) => {
    const user = await requireUser(req, env);
    requireAdmin(env, user.username);
    const body = await readJson(req);
    const note = str(body, "note", { max: 1000 });
    await recordOpsEvent(env, {
      kind: "chat",
      status: "ok",
      user_id: user.id,
      username: user.username,
      note,
      phase: "note",
      features: { manual: true },
    });
    return json({ ok: true });
  });
}

function summarizeTrace(rows: Awaited<ReturnType<typeof listOpsEvents>>): string {
  const bits: string[] = [];
  for (const row of rows) {
    const label = row.phase ? `${row.kind}.${row.phase}` : row.kind;
    const mark = row.status === "ok" ? "✓" : row.status === "skipped" ? "·" : "✗";
    const extra = row.route || row.path || row.error_code || "";
    bits.push(`${mark} ${label}${extra ? ` ${extra}` : ""}`);
  }
  return bits.join(" → ");
}
