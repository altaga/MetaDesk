import { DeviceRow } from "../devices/service";
import { Env, nowSec } from "../env";
import { HttpError, str } from "../http";
import { balance } from "../subscription/service";
import { TAVILY_CREDITS } from "../subscription/catalog";

const BASIC_SEARCH_CREDITS = 1;

/**
 * Commits the spend before the HTTP call, atomically against both the account's plan
 * and the lifetime cap on the shared key. Returns false when either is used up.
 */
async function reserve(env: Env, device: DeviceRow, note: string): Promise<boolean> {
  const result = await env.DB.prepare(
    `INSERT INTO usage_ledger (user_id, device_id, kind, credits, note, created_at)
     SELECT ?1, ?2, 'tavily', ?3, ?4, ?5
     WHERE (SELECT COALESCE(SUM(credits), 0) FROM usage_ledger WHERE kind = 'tavily') + ?3 <= ?6
       AND (SELECT COALESCE(SUM(credits), 0) FROM usage_ledger WHERE kind = 'tavily' AND user_id = ?1) + ?3 <= ?7`
  )
    .bind(device.user_id, device.id, BASIC_SEARCH_CREDITS, note.slice(0, 200), nowSec(), Number(env.TAVILY_KEY_CAP), TAVILY_CREDITS)
    .run();
  return (result.meta.changes ?? 0) > 0;
}

async function refund(env: Env, device: DeviceRow, note: string): Promise<void> {
  await env.DB.prepare(
    "INSERT INTO usage_ledger (user_id, device_id, kind, credits, note, created_at) VALUES (?1, ?2, 'tavily', ?3, ?4, ?5)"
  )
    .bind(device.user_id, device.id, -BASIC_SEARCH_CREDITS, `refund:${note}`.slice(0, 200), nowSec())
    .run();
}

function mock(query: string) {
  return {
    query,
    dummy: true,
    results: [{ title: `[Search mock] Results for: ${query}`, url: "https://tavily.com", content: "The desk has no search key." }],
  };
}

export async function tavilySearch(env: Env, device: DeviceRow, body: Record<string, unknown>) {
  const query = str(body, "query", { max: 500 });
  const maxResults = Math.max(1, Math.min(10, Number(body.max_results) || 5));
  const bal = await balance(env, device.user_id);
  if (!bal.active) throw new HttpError(402, "subscription_inactive", { tool: "search" });
  if (!env.TAVILY_API_KEY) return mock(query);

  if (!(await reserve(env, device, query))) {
    throw new HttpError(402, "tavily_credit_cap", { credits_spent: bal.tavily_credits_spent, credit_cap: bal.tavily_credits });
  }
  let data: Record<string, unknown>;
  try {
    const res = await fetch("https://api.tavily.com/search", {
      method: "POST",
      headers: { "content-type": "application/json", authorization: `Bearer ${env.TAVILY_API_KEY}` },
      body: JSON.stringify({ query, max_results: maxResults, search_depth: "basic" }),
    });
    if (!res.ok) throw new Error(`tavily_http_${res.status}`);
    data = (await res.json()) as Record<string, unknown>;
  } catch (err) {
    await refund(env, device, query);
    throw new HttpError(502, "tavily_error", { reason: err instanceof Error ? err.message : "unknown" });
  }
  return {
    ...data,
    credits_charged: BASIC_SEARCH_CREDITS,
    credits_remaining: Math.max(0, bal.tavily_credits_remaining - BASIC_SEARCH_CREDITS),
    credit_cap: bal.tavily_credits,
  };
}
