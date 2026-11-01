import { Env, nowSec } from "../env";
import { CLOUD_CREDIT_USD, PLAN_ID, PLAN_NAME, PRICE_LABEL, TAVILY_CREDITS } from "./catalog";

export async function ensureSubscription(env: Env, userId: number): Promise<void> {
  await env.DB.prepare("INSERT OR IGNORE INTO subscriptions (user_id, plan_id, status, created_at) VALUES (?1, ?2, 'active', ?3)")
    .bind(userId, PLAN_ID, nowSec())
    .run();
}

export async function isActive(env: Env, userId: number): Promise<boolean> {
  const row = await env.DB.prepare("SELECT status FROM subscriptions WHERE user_id = ?1").bind(userId).first<{ status: string }>();
  return row?.status === "active";
}

export async function cloudSpentUsd(env: Env, userId: number): Promise<number> {
  const row = await env.DB.prepare(
    "SELECT COALESCE(SUM(cost_usd), 0) AS spent FROM usage_ledger WHERE user_id = ?1 AND kind = 'meta'"
  )
    .bind(userId)
    .first<{ spent: number }>();
  return row?.spent ?? 0;
}

export async function tavilySpent(env: Env, userId: number | null): Promise<number> {
  const sql =
    userId == null
      ? "SELECT COALESCE(SUM(credits), 0) AS spent FROM usage_ledger WHERE kind = 'tavily'"
      : "SELECT COALESCE(SUM(credits), 0) AS spent FROM usage_ledger WHERE kind = 'tavily' AND user_id = ?1";
  const stmt = env.DB.prepare(sql);
  const row = await (userId == null ? stmt : stmt.bind(userId)).first<{ spent: number }>();
  return row?.spent ?? 0;
}

export type Balance = {
  plan_id: string;
  plan_name: string;
  price_label: string;
  status: string;
  active: boolean;
  cloud_credit_usd: number;
  cloud_spent_usd: number;
  cloud_remaining_usd: number;
  tavily_credits: number;
  tavily_credits_spent: number;
  tavily_credits_remaining: number;
};

/** Plan allowance for one account. Search never exceeds what is left on the shared key. */
export async function balance(env: Env, userId: number): Promise<Balance> {
  await ensureSubscription(env, userId);
  const [active, spent, tavilyUser, tavilyAll] = await Promise.all([
    isActive(env, userId),
    cloudSpentUsd(env, userId),
    tavilySpent(env, userId),
    tavilySpent(env, null),
  ]);
  const keyLeft = Math.max(0, Number(env.TAVILY_KEY_CAP) - tavilyAll);
  const planLeft = Math.max(0, TAVILY_CREDITS - tavilyUser);
  return {
    plan_id: PLAN_ID,
    plan_name: PLAN_NAME,
    price_label: PRICE_LABEL,
    status: active ? "active" : "inactive",
    active,
    cloud_credit_usd: CLOUD_CREDIT_USD,
    cloud_spent_usd: Number(spent.toFixed(6)),
    cloud_remaining_usd: Number(Math.max(0, CLOUD_CREDIT_USD - spent).toFixed(6)),
    tavily_credits: TAVILY_CREDITS,
    tavily_credits_spent: tavilyUser,
    tavily_credits_remaining: Math.min(planLeft, keyLeft),
  };
}
