import { DeviceRow } from "../devices/service";
import { Env, nowSec } from "../env";
import { HttpError } from "../http";
import { chatFeatures, lenBucket } from "../ops/features";
import { recordOpsEvent, usernameFor } from "../ops/service";
import { balance } from "../subscription/service";
import { costUsd } from "./pricing";
import { metaChatCompletions } from "./upstream";

const MAX_OUTPUT_TOKENS = 8192;

type Usage = { prompt_tokens: number; completion_tokens: number };

function chatBody(body: Record<string, unknown>): Record<string, unknown> & { model: string } {
  if (typeof body.model !== "string" || !body.model) throw new HttpError(422, "missing_field", { field: "model" });
  if (!Array.isArray(body.messages)) throw new HttpError(422, "missing_field", { field: "messages" });
  const maxTokens = Math.min(Number(body.max_tokens) || 4096, MAX_OUTPUT_TOKENS);
  return {
    ...body,
    model: body.model,
    max_tokens: maxTokens,
    stream: true,
    stream_options: { include_usage: true },
  };
}

function lastUserText(messages: unknown): string {
  if (!Array.isArray(messages)) return "";
  for (let i = messages.length - 1; i >= 0; i--) {
    const m = messages[i] as { role?: string; content?: unknown };
    if (m?.role !== "user") continue;
    if (typeof m.content === "string") return m.content;
    if (Array.isArray(m.content)) {
      return m.content
        .map((p) => (p && typeof p === "object" && "text" in p ? String((p as { text: unknown }).text) : ""))
        .join("");
    }
  }
  return "";
}

/** Reads a copy of the SSE stream to the end and returns the final usage block. */
async function readUsage(stream: ReadableStream<Uint8Array>): Promise<Usage> {
  const reader = stream.pipeThrough(new TextDecoderStream()).getReader();
  let buffer = "";
  let usage: Usage = { prompt_tokens: 0, completion_tokens: 0 };
  for (;;) {
    const { value, done } = await reader.read();
    if (done) break;
    buffer += value;
    const lines = buffer.split("\n");
    buffer = lines.pop() ?? "";
    for (const line of lines) {
      if (!line.startsWith("data: ") || !line.includes('"usage"')) continue;
      try {
        const u = JSON.parse(line.slice(6)).usage;
        if (u) usage = { prompt_tokens: Number(u.prompt_tokens) || 0, completion_tokens: Number(u.completion_tokens) || 0 };
      } catch {
        // partial or non-JSON line
      }
    }
  }
  return usage;
}

async function record(env: Env, device: DeviceRow, model: string, usage: Usage): Promise<void> {
  const cost = costUsd(model, usage.prompt_tokens, usage.completion_tokens);
  await env.DB.prepare(
    `INSERT INTO usage_ledger (user_id, device_id, kind, model, prompt_tokens, completion_tokens, cost_usd, created_at)
     VALUES (?1, ?2, 'meta', ?3, ?4, ?5, ?6, ?7)`
  )
    .bind(device.user_id, device.id, model, usage.prompt_tokens, usage.completion_tokens, cost, nowSec())
    .run();
}

export async function proxyMeta(
  env: Env,
  ctx: ExecutionContext,
  device: DeviceRow,
  body: Record<string, unknown>
): Promise<Response> {
  const t0 = Date.now();
  const username = await usernameFor(env, device.user_id);
  const userText = lastUserText(body.messages);

  if (!env.META_API_KEY) {
    await recordOpsEvent(env, {
      kind: "gateway",
      status: "error",
      error_code: "gateway_unconfigured",
      user_id: device.user_id,
      username,
      device_id: device.id,
      features: { msg_len: lenBucket(userText) },
      input_text: userText,
      latency_ms: Date.now() - t0,
    });
    throw new HttpError(503, "gateway_unconfigured");
  }
  const bal = await balance(env, device.user_id);
  if (!bal.active) {
    await recordOpsEvent(env, {
      kind: "gateway",
      status: "error",
      error_code: "subscription_inactive",
      user_id: device.user_id,
      username,
      device_id: device.id,
      features: chatFeatures(userText, ""),
      input_text: userText,
      latency_ms: Date.now() - t0,
    });
    throw new HttpError(402, "subscription_inactive");
  }
  if (bal.cloud_remaining_usd <= 0) {
    await recordOpsEvent(env, {
      kind: "gateway",
      status: "error",
      error_code: "cloud_credit_used",
      user_id: device.user_id,
      username,
      device_id: device.id,
      features: chatFeatures(userText, ""),
      input_text: userText,
      latency_ms: Date.now() - t0,
    });
    throw new HttpError(402, "cloud_credit_used", { spent: bal.cloud_spent_usd });
  }

  const payload = chatBody(body);
  const upstream = await metaChatCompletions(env, payload);
  if (!upstream.ok || !upstream.body) {
    const detail = (await upstream.text()).slice(0, 300);
    await recordOpsEvent(env, {
      kind: "gateway",
      status: "error",
      error_code: "meta_error",
      user_id: device.user_id,
      username,
      device_id: device.id,
      model: payload.model,
      features: chatFeatures(userText, ""),
      input_text: userText,
      latency_ms: Date.now() - t0,
      note: `status=${upstream.status} body=${detail.slice(0, 180)}`,
    });
    return new Response(JSON.stringify({ detail: { error: "meta_error", status: upstream.status, body: detail } }), {
      status: upstream.status >= 500 ? 502 : upstream.status,
      headers: { "content-type": "application/json" },
    });
  }
  const [toBoard, toMeter] = upstream.body.tee();
  ctx.waitUntil(
    readUsage(toMeter).then(async (usage) => {
      await record(env, device, payload.model, usage);
      const cost = costUsd(payload.model, usage.prompt_tokens, usage.completion_tokens);
      await recordOpsEvent(env, {
        kind: "gateway",
        status: "ok",
        user_id: device.user_id,
        username,
        device_id: device.id,
        model: payload.model,
        route: "meta",
        latency_ms: Date.now() - t0,
        prompt_tokens: usage.prompt_tokens,
        completion_tokens: usage.completion_tokens,
        cost_usd: cost,
        features: chatFeatures(userText, "", { stream: true }),
        input_text: userText,
        note: "gateway_stream_complete",
      });
    })
  );
  return new Response(toBoard, {
    headers: { "content-type": "text/event-stream", "cache-control": "no-cache" },
  });
}
