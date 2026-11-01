import { Env, nowSec } from "../env";

export type OpsKind = "guide" | "chat" | "gateway" | "relay" | "search" | "tool";
export type OpsStatus = "ok" | "error" | "skipped" | "partial";

export type OpsEventInput = {
  kind: OpsKind;
  status: OpsStatus;
  error_code?: string | null;
  user_id?: number | null;
  username?: string | null;
  device_id?: string | null;
  session_id?: string | null;
  trace_id?: string | null;
  phase?: string | null;
  route?: string | null;
  model?: string | null;
  intent?: string | null;
  latency_ms?: number | null;
  prompt_tokens?: number;
  completion_tokens?: number;
  cost_usd?: number;
  path?: string | null;
  features?: Record<string, unknown> | null;
  /** Only persisted when username === BOOTSTRAP_USERNAME. */
  input_text?: string | null;
  output_text?: string | null;
  note?: string | null;
};

export type OpsEventRow = {
  id: number;
  created_at: number;
  kind: string;
  status: string;
  error_code: string | null;
  privacy: string;
  user_id: number | null;
  username: string | null;
  device_id: string | null;
  session_id: string | null;
  trace_id: string | null;
  phase: string | null;
  route: string | null;
  model: string | null;
  intent: string | null;
  latency_ms: number | null;
  prompt_tokens: number;
  completion_tokens: number;
  cost_usd: number;
  path: string | null;
  features_json: string | null;
  input_text: string | null;
  output_text: string | null;
  note: string | null;
};

/** Accounts that get the admin lens: the operator's bootstrap login. */
export function isBootstrapAdmin(env: Env, username: string | null | undefined): boolean {
  const names = [env.BOOTSTRAP_USERNAME || "admin"].map((name) => name.trim().toLowerCase()).filter(Boolean);
  return Boolean(username && names.includes(username.trim().toLowerCase()));
}

function clip(text: string | null | undefined, max = 4000): string | null {
  if (!text) return null;
  return text.length <= max ? text : `${text.slice(0, max)}…`;
}

/** Persist one ops row. Never stores user I/O unless the actor is the bootstrap admin. */
export async function recordOpsEvent(env: Env, event: OpsEventInput): Promise<void> {
  const full = isBootstrapAdmin(env, event.username);
  const privacy = full ? "full" : "redacted";
  const featuresJson = event.features ? JSON.stringify(sanitizeFeatures(event.features, full)) : null;
  const inputText = full ? clip(event.input_text) : null;
  const outputText = full ? clip(event.output_text) : null;
  const created = nowSec();

  try {
    await env.DB.prepare(
      `INSERT INTO ops_events (
         created_at, kind, status, error_code, privacy, user_id, username, device_id, session_id,
         route, model, intent, latency_ms, prompt_tokens, completion_tokens, cost_usd, path,
         features_json, input_text, output_text, note, trace_id, phase
       ) VALUES (
         ?1,?2,?3,?4,?5,?6,?7,?8,?9,?10,?11,?12,?13,?14,?15,?16,?17,?18,?19,?20,?21,?22,?23
       )`
    )
      .bind(
        created,
        event.kind,
        event.status,
        event.error_code ?? null,
        privacy,
        event.user_id ?? null,
        event.username ?? null,
        event.device_id ?? null,
        event.session_id ?? null,
        event.route ?? null,
        event.model ?? null,
        event.intent ?? null,
        event.latency_ms ?? null,
        event.prompt_tokens ?? 0,
        event.completion_tokens ?? 0,
        event.cost_usd ?? 0,
        event.path ?? null,
        featuresJson,
        inputText,
        outputText,
        event.note ?? null,
        event.trace_id ?? null,
        event.phase ?? null
      )
      .run();
  } catch (err) {
    console.error("ops_insert_failed", err instanceof Error ? err.message : String(err));
  }

  console.log(
    JSON.stringify({
      ops: true,
      kind: event.kind,
      status: event.status,
      error_code: event.error_code ?? null,
      privacy,
      trace_id: event.trace_id ?? null,
      phase: event.phase ?? null,
      user_id: event.user_id ?? null,
      username: event.username ?? null,
      device_id: event.device_id ?? null,
      session_id: event.session_id ?? null,
      route: event.route ?? null,
      model: event.model ?? null,
      intent: event.intent ?? null,
      latency_ms: event.latency_ms ?? null,
      path: event.path ?? null,
      features: event.features ?? null,
      note: event.note ?? null,
      ...(full ? { input_text: inputText, output_text: outputText } : {}),
    })
  );
}

/** Drop secrets-looking feature keys; strip command/stdout for non-admin. */
function sanitizeFeatures(features: Record<string, unknown>, full: boolean): Record<string, unknown> {
  const out: Record<string, unknown> = {};
  for (const [key, value] of Object.entries(features)) {
    if (/secret|token|password|authorization|api_key/i.test(key)) continue;
    if (!full && (key === "command" || key === "command_preview" || key === "stdout" || key === "stderr")) continue;
    out[key] = value;
  }
  return out;
}

export async function listOpsEvents(
  env: Env,
  opts: {
    kind?: string;
    status?: string;
    trace_id?: string;
    device_id?: string;
    user_id?: number;
    errors_only?: boolean;
    limit: number;
    since_sec?: number;
  }
): Promise<OpsEventRow[]> {
  const limit = Math.min(Math.max(opts.limit, 1), 200);
  const clauses: string[] = [];
  const binds: unknown[] = [];
  let i = 1;
  if (opts.kind) {
    clauses.push(`kind = ?${i++}`);
    binds.push(opts.kind);
  }
  if (opts.status) {
    clauses.push(`status = ?${i++}`);
    binds.push(opts.status);
  }
  if (opts.errors_only) {
    clauses.push(`status IN ('error', 'partial')`);
  }
  if (opts.trace_id) {
    clauses.push(`trace_id = ?${i++}`);
    binds.push(opts.trace_id);
  }
  if (opts.device_id) {
    clauses.push(`device_id = ?${i++}`);
    binds.push(opts.device_id);
  }
  if (opts.user_id != null) {
    clauses.push(`user_id = ?${i++}`);
    binds.push(opts.user_id);
  }
  if (opts.since_sec) {
    clauses.push(`created_at >= ?${i++}`);
    binds.push(opts.since_sec);
  }
  const where = clauses.length ? `WHERE ${clauses.join(" AND ")}` : "";
  binds.push(limit);
  const { results } = await env.DB.prepare(
    `SELECT * FROM ops_events ${where} ORDER BY id DESC LIMIT ?${i}`
  )
    .bind(...binds)
    .all<OpsEventRow>();
  return results;
}

export function redactForUser(row: OpsEventRow): Record<string, unknown> {
  return {
    id: row.id,
    created_at: row.created_at,
    created_at_iso: new Date(row.created_at * 1000).toISOString(),
    kind: row.kind,
    status: row.status,
    error_code: row.error_code,
    phase: row.phase,
    route: row.route,
    path: row.path,
    latency_ms: row.latency_ms,
    device_id: row.device_id,
    trace_id: row.trace_id,
    // Never I/O for user lens.
    input_text: null,
    output_text: null,
    note: row.status === "error" || row.status === "partial" ? row.note : null,
    features: summarizeFeatures(row.features_json),
  };
}

export function presentAdmin(row: OpsEventRow): Record<string, unknown> {
  return {
    ...row,
    features: row.features_json ? safeJson(row.features_json) : null,
    features_json: undefined,
    created_at_iso: new Date(row.created_at * 1000).toISOString(),
  };
}

function summarizeFeatures(raw: string | null): Record<string, unknown> | null {
  const parsed = raw ? safeJson(raw) : null;
  if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) return null;
  const src = parsed as Record<string, unknown>;
  const out: Record<string, unknown> = {};
  for (const key of [
    "action_types",
    "actions",
    "tool_kinds",
    "tool_count",
    "exit_code",
    "approval",
    "duration_ms",
    "lang",
    "msg_len",
    "highlight_targets",
  ]) {
    if (key in src) out[key] = src[key];
  }
  return Object.keys(out).length ? out : null;
}

function safeJson(raw: string): unknown {
  try {
    return JSON.parse(raw);
  } catch {
    return null;
  }
}

export async function usernameFor(env: Env, userId: number): Promise<string | null> {
  const row = await env.DB.prepare("SELECT username FROM users WHERE id = ?1")
    .bind(userId)
    .first<{ username: string }>();
  return row?.username ?? null;
}
