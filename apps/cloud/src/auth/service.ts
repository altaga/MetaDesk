import { hashPassword, randomToken, sha256Hex, verifyPassword } from "../crypto";
import { Env, nowSec } from "../env";
import { HttpError } from "../http";
import { ensureSubscription } from "../subscription/service";
import { signAccess } from "./jwt";
import { generateSecret, verifyTotp } from "./totp";

export const ACCESS_TTL_SEC = 15 * 60;
export const REFRESH_TTL_SEC = 30 * 24 * 3600;

export type UserRow = {
  id: number;
  username: string;
  password_hash: string;
  totp_secret: string | null;
  totp_enabled: number;
};

export type Tokens = {
  access_token: string;
  refresh_token: string;
  token_type: "bearer";
  expires_in: number;
  refresh_expires_in: number;
};

export function findUser(env: Env, username: string): Promise<UserRow | null> {
  return env.DB.prepare("SELECT * FROM users WHERE username = ?1").bind(username).first<UserRow>();
}

type Seed = { username?: string; password?: string };

/** Deploy-seeded login for the operator bootstrap account. */
function seeds(env: Env): Seed[] {
  return [{ username: env.BOOTSTRAP_USERNAME, password: env.BOOTSTRAP_PASSWORD }];
}

/** A seeded account is created on first use from its deploy secret, on the `desk` plan. */
async function ensureSeedUser(env: Env, username: string): Promise<UserRow | null> {
  const seed = seeds(env).find((s) => s.username && s.username === username && s.password);
  if (!seed?.password) return null;
  const hash = await hashPassword(seed.password);
  await env.DB.prepare(
    "INSERT OR IGNORE INTO users (username, password_hash, totp_secret, totp_enabled, created_at) VALUES (?1, ?2, ?3, 0, ?4)"
  )
    .bind(username, hash, generateSecret(), nowSec())
    .run();
  const user = await findUser(env, username);
  if (user) await ensureSubscription(env, user.id);
  return user;
}

async function issueTokens(env: Env, user: Pick<UserRow, "id" | "username">): Promise<Tokens> {
  const refresh = randomToken();
  await env.DB.prepare("INSERT INTO refresh_tokens (token_hash, user_id, expires_at) VALUES (?1, ?2, ?3)")
    .bind(await sha256Hex(refresh), user.id, nowSec() + REFRESH_TTL_SEC)
    .run();
  return {
    access_token: await signAccess(env.JWT_SECRET, user.id, user.username, ACCESS_TTL_SEC),
    refresh_token: refresh,
    token_type: "bearer",
    expires_in: ACCESS_TTL_SEC,
    refresh_expires_in: REFRESH_TTL_SEC,
  };
}

export async function login(env: Env, username: string, password: string, totpCode: string): Promise<Tokens> {
  const user = (await findUser(env, username)) ?? (await ensureSeedUser(env, username));
  if (!user || !(await verifyPassword(password, user.password_hash))) {
    throw new HttpError(401, "invalid_credentials");
  }
  if (user.totp_enabled && !(user.totp_secret && (await verifyTotp(user.totp_secret, totpCode)))) {
    throw new HttpError(401, "invalid_totp");
  }
  return issueTokens(env, user);
}

/** Single use, with a short grace so a reload and an in-flight request can both refresh. */
const REUSE_GRACE_SEC = 60;

export async function refresh(env: Env, token: string): Promise<Tokens> {
  const hash = await sha256Hex(token);
  const row = await env.DB.prepare("SELECT user_id, expires_at FROM refresh_tokens WHERE token_hash = ?1")
    .bind(hash)
    .first<{ user_id: number; expires_at: number }>();
  if (!row || row.expires_at < nowSec()) throw new HttpError(401, "invalid_refresh");
  const until = nowSec() + REUSE_GRACE_SEC;
  if (row.expires_at > until) {
    await env.DB.prepare("UPDATE refresh_tokens SET expires_at = ?2 WHERE token_hash = ?1").bind(hash, until).run();
  }
  const user = await env.DB.prepare("SELECT id, username FROM users WHERE id = ?1")
    .bind(row.user_id)
    .first<{ id: number; username: string }>();
  if (!user) throw new HttpError(401, "invalid_refresh");
  return issueTokens(env, user);
}

export async function logout(env: Env, token: string): Promise<void> {
  await env.DB.prepare("DELETE FROM refresh_tokens WHERE token_hash = ?1").bind(await sha256Hex(token)).run();
}
