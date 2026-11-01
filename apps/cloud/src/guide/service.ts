import { deviceView, listDevices, ownedDevice, type DeviceRow } from "../devices/service";
import { Env, nowSec } from "../env";
import { HttpError } from "../http";
import { costUsd } from "../gateway/pricing";
import { guideFeatures } from "../ops/features";
import { recordOpsEvent, usernameFor } from "../ops/service";
import { balance } from "../subscription/service";
import { GuideAction, parseGuideReply, polishGuideTurn } from "./actions";
import { buildDeskContext, type DeskHints } from "./context";
import { GUIDE_HISTORY, GUIDE_MODEL, GUIDE_SYSTEM } from "./prompt";

export type GuideEvent =
  | {
      type: "start";
      session_id: string;
      route: string;
      model: string;
      intent: string;
      thinking: boolean;
      compressed: boolean;
      note: string;
      trace_id: string;
    }
  | { type: "delta"; kind: "text"; text: string }
  | { type: "action"; action: GuideAction }
  | {
      type: "done";
      session_id: string;
      message: { role: "assistant"; content: string; meta: Record<string, unknown> };
      actions: GuideAction[];
      trace_id: string;
    }
  | { type: "error"; detail: string };

async function openSession(env: Env, userId: number, deviceId: string, sessionId: string | null): Promise<string> {
  if (sessionId) {
    const row = await env.DB.prepare("SELECT id FROM guide_sessions WHERE id = ?1 AND user_id = ?2")
      .bind(sessionId, userId)
      .first<{ id: string }>();
    if (row) return row.id;
  }
  const id = crypto.randomUUID();
  const t = nowSec();
  await env.DB.prepare(
    "INSERT INTO guide_sessions (id, user_id, device_id, created_at, updated_at) VALUES (?1, ?2, ?3, ?4, ?5)"
  )
    .bind(id, userId, deviceId, t, t)
    .run();
  return id;
}

async function history(env: Env, sessionId: string): Promise<Array<{ role: string; content: string }>> {
  const { results } = await env.DB.prepare(
    "SELECT role, content FROM guide_messages WHERE session_id = ?1 ORDER BY id DESC LIMIT ?2"
  )
    .bind(sessionId, GUIDE_HISTORY)
    .all<{ role: string; content: string }>();
  return results.reverse();
}

async function appendMessage(env: Env, sessionId: string, role: string, content: string): Promise<void> {
  const t = nowSec();
  await env.DB.prepare(
    "INSERT INTO guide_messages (session_id, role, content, created_at) VALUES (?1, ?2, ?3, ?4)"
  )
    .bind(sessionId, role, content, t)
    .run();
  await env.DB.prepare("UPDATE guide_sessions SET updated_at = ?1 WHERE id = ?2").bind(t, sessionId).run();
}

/** One non-streaming Muse turn for Nova. Cheap model, tight max_tokens. */
async function callGuide(
  env: Env,
  messages: Array<{ role: string; content: string }>
): Promise<{ text: string; prompt_tokens: number; completion_tokens: number }> {
  if (!env.META_API_KEY) throw new HttpError(503, "gateway_unconfigured");
  const upstream = await fetch(`${env.META_BASE_URL.replace(/\/$/, "")}/chat/completions`, {
    method: "POST",
    headers: { authorization: `Bearer ${env.META_API_KEY}`, "content-type": "application/json" },
    body: JSON.stringify({
      model: GUIDE_MODEL,
      messages,
      // Muse reasons before it answers; uncapped, a short budget is all reasoning
      // and the reply comes back empty. Nova only needs a line or two.
      reasoning_effort: "minimal",
      max_tokens: 1200,
      temperature: 0.6,
      stream: false,
    }),
  });
  const raw = await upstream.text();
  if (!upstream.ok) {
    throw new HttpError(upstream.status >= 500 ? 502 : upstream.status, "meta_error", {
      body: raw.slice(0, 200),
    });
  }
  const data = JSON.parse(raw) as {
    choices?: Array<{ message?: { content?: string; reasoning_content?: string } }>;
    usage?: { prompt_tokens?: number; completion_tokens?: number };
  };
  const message = data.choices?.[0]?.message;
  const text = (message?.content || "").trim();
  return {
    text,
    prompt_tokens: Number(data.usage?.prompt_tokens) || 0,
    completion_tokens: Number(data.usage?.completion_tokens) || 0,
  };
}

/** Run one Nova turn in the cloud. Yields the same SSE event shape the web client expects. */
export async function* streamGuideTurn(
  env: Env,
  userId: number,
  opts: { content: string; session_id: string | null; device_id: string; desk?: DeskHints }
): AsyncGenerator<GuideEvent> {
  const t0 = Date.now();
  const username = await usernameFor(env, userId);
  // The board is optional context. Nova never reaches it; an unknown or missing
  // board just means she answers about the account and the desk in general.
  let device: DeviceRow | null = null;
  if (opts.device_id) {
    try {
      device = await ownedDevice(env, userId, opts.device_id);
    } catch {
      device = null;
    }
  }
  const deviceId = device?.id ?? null;
  const bal = await balance(env, userId);
  if (!bal.active) {
    await recordOpsEvent(env, {
      kind: "guide",
      status: "error",
      error_code: "subscription_inactive",
      user_id: userId,
      username,
      device_id: deviceId,
      features: guideFeatures(opts.content, "", []),
      input_text: opts.content,
      latency_ms: Date.now() - t0,
    });
    yield { type: "error", detail: "subscription_inactive" };
    return;
  }
  if (bal.cloud_remaining_usd <= 0) {
    await recordOpsEvent(env, {
      kind: "guide",
      status: "error",
      error_code: "cloud_credit_used",
      user_id: userId,
      username,
      device_id: deviceId,
      features: guideFeatures(opts.content, "", []),
      input_text: opts.content,
      latency_ms: Date.now() - t0,
    });
    yield { type: "error", detail: "cloud_credit_used" };
    return;
  }

  const sessionId = await openSession(env, userId, deviceId ?? "", opts.session_id);
  const traceId = `req_${crypto.randomUUID().replace(/-/g, "").slice(0, 20)}`;
  yield {
    type: "start",
    session_id: sessionId,
    trace_id: traceId,
    route: "cloud",
    model: GUIDE_MODEL,
    intent: "guide",
    thinking: false,
    compressed: false,
    note: "nova-cloud",
  };

  const prior = await history(env, sessionId);
  await appendMessage(env, sessionId, "user", opts.content);
  const fleet = await listDevices(env, userId);
  const deskBlock = buildDeskContext(fleet, device, bal, opts.desk || {});

  const messages = [
    { role: "system", content: `${GUIDE_SYSTEM}\n\nDesk context:\n${deskBlock}` },
    ...prior,
    { role: "user", content: opts.content },
  ];

  let reply: { text: string; prompt_tokens: number; completion_tokens: number };
  try {
    reply = await callGuide(env, messages);
  } catch (err) {
    const detail = err instanceof HttpError ? err.code : "guide_failed";
    await recordOpsEvent(env, {
      kind: "guide",
      status: "error",
      error_code: detail,
      user_id: userId,
      username,
      device_id: deviceId,
      session_id: sessionId,
      route: "cloud",
      model: GUIDE_MODEL,
      intent: "guide",
      features: guideFeatures(opts.content, "", []),
      input_text: opts.content,
      latency_ms: Date.now() - t0,
      note: err instanceof HttpError && err.extra?.body ? String(err.extra.body).slice(0, 200) : null,
    });
    yield { type: "error", detail };
    return;
  }

  if (!reply.text.trim()) {
    await recordOpsEvent(env, {
      kind: "guide",
      status: "error",
      error_code: "empty_reply",
      user_id: userId,
      username,
      device_id: deviceId,
      session_id: sessionId,
      route: "cloud",
      model: GUIDE_MODEL,
      intent: "guide",
      prompt_tokens: reply.prompt_tokens,
      completion_tokens: reply.completion_tokens,
      features: guideFeatures(opts.content, "", []),
      input_text: opts.content,
      latency_ms: Date.now() - t0,
    });
    yield { type: "error", detail: "empty_reply" };
    return;
  }

  const parsed = parseGuideReply(reply.text);
  const polished = polishGuideTurn(opts.content, parsed.text, parsed.actions, {
    boardName: device ? deviceView(device).name || device.name : null,
    fleet,
    balance: bal,
    boardEmu: Boolean(device?.board_emu),
    desk: opts.desk || {},
  });
  // Stream only the polished spoken line — never the raw model echo of the user question.
  const spoken = polished.text || "";
  const chunk = 24;
  for (let i = 0; i < spoken.length; i += chunk) {
    yield { type: "delta", kind: "text", text: spoken.slice(i, i + chunk) };
  }

  // Keep the fence in history so later turns still emit tools (display text alone teaches the model to narrate).
  await appendMessage(env, sessionId, "assistant", reply.text.trim());

  const cost = costUsd(GUIDE_MODEL, reply.prompt_tokens, reply.completion_tokens);
  await env.DB.prepare(
    `INSERT INTO usage_ledger (user_id, device_id, kind, model, prompt_tokens, completion_tokens, cost_usd, created_at)
     VALUES (?1, ?2, 'meta', ?3, ?4, ?5, ?6, ?7)`
  )
    .bind(userId, deviceId, GUIDE_MODEL, reply.prompt_tokens, reply.completion_tokens, cost, nowSec())
    .run();

  await recordOpsEvent(env, {
    kind: "guide",
    status: "ok",
    phase: "plan",
    trace_id: traceId,
    user_id: userId,
    username,
    device_id: deviceId,
    session_id: sessionId,
    route: "cloud",
    model: GUIDE_MODEL,
    intent: "guide",
    latency_ms: Date.now() - t0,
    prompt_tokens: reply.prompt_tokens,
    completion_tokens: reply.completion_tokens,
    cost_usd: cost,
    features: guideFeatures(opts.content, reply.text, polished.actions),
    input_text: opts.content,
    output_text: polished.text || reply.text,
  });

  for (const action of polished.actions) {
    yield { type: "action", action };
  }
  yield {
    type: "done",
    session_id: sessionId,
    trace_id: traceId,
    message: {
      role: "assistant",
      content: polished.text,
      meta: {
        route: "cloud",
        model: GUIDE_MODEL,
        prompt_tokens: reply.prompt_tokens,
        completion_tokens: reply.completion_tokens,
        cost_usd: cost,
        guide_actions: polished.actions,
      },
    },
    actions: polished.actions,
  };
}
