/**
 * Optional request signing for /v1/gateway/* (board → Worker).
 *
 * Enable with env GATEWAY_HMAC=required (or "1"). When off, signatures are
 * accepted if present but not required — so boards can roll out gradually.
 *
 * Headers:
 *   X-Desk-Timestamp  unix seconds
 *   X-Desk-Nonce      unique id (≤80 chars)
 *   X-Desk-Signature  hex HMAC-SHA256 over:
 *     method \n path_with_query \n timestamp \n nonce \n sha256_hex(body)
 *
 * Signing key = device_token (only the board holds it; Worker verifies using
 * the same bearer token presented on the request — never stored in plaintext).
 */

import { Env } from "../env";
import { HttpError, bearer } from "../http";

const NONCE_TTL_SEC = 120;
const SKEW_SEC = 60;

export async function assertGatewayHmac(req: Request, env: Env, body: ArrayBuffer | null): Promise<void> {
  const mode = (env.GATEWAY_HMAC || "").toLowerCase();
  const required = mode === "required" || mode === "1" || mode === "true";
  const sig = req.headers.get("x-desk-signature");
  const ts = req.headers.get("x-desk-timestamp");
  const nonce = req.headers.get("x-desk-nonce");
  if (!sig || !ts || !nonce) {
    if (required) throw new HttpError(401, "signature_required");
    return;
  }
  const token = bearer(req);
  if (!token) throw new HttpError(401, "missing_token");

  const tsNum = Number(ts);
  if (!Number.isFinite(tsNum)) throw new HttpError(401, "timestamp_invalid");
  const now = Math.floor(Date.now() / 1000);
  if (Math.abs(now - tsNum) > SKEW_SEC) throw new HttpError(401, "timestamp_skew", {}, true);

  if (nonce.length < 8 || nonce.length > 80) throw new HttpError(401, "nonce_invalid");
  try {
    await env.DB.prepare(
      "CREATE TABLE IF NOT EXISTS hmac_nonces (nonce TEXT PRIMARY KEY, expires_at INTEGER NOT NULL)"
    ).run();
    const existing = await env.DB.prepare("SELECT nonce FROM hmac_nonces WHERE nonce = ?1").bind(nonce).first();
    if (existing) throw new HttpError(401, "nonce_reuse");
    await env.DB.prepare("INSERT INTO hmac_nonces (nonce, expires_at) VALUES (?1, ?2)").bind(nonce, now + NONCE_TTL_SEC).run();
    await env.DB.prepare("DELETE FROM hmac_nonces WHERE expires_at < ?1").bind(now).run();
  } catch (err) {
    if (err instanceof HttpError) throw err;
    // D1 blip — fail closed when required
    if (required) throw new HttpError(503, "nonce_store_unavailable", {}, true);
  }

  const url = new URL(req.url);
  const path = `${url.pathname}${url.search}`;
  const bodyHash = await sha256Hex(body ? new Uint8Array(body) : new Uint8Array());
  const payload = `${req.method.toUpperCase()}\n${path}\n${ts}\n${nonce}\n${bodyHash}`;
  const expected = await hmacHex(token, payload);
  if (!timingSafeEqualHex(expected, sig.trim().toLowerCase())) {
    throw new HttpError(401, "signature_invalid");
  }
}

async function sha256Hex(bytes: Uint8Array): Promise<string> {
  const dig = await crypto.subtle.digest("SHA-256", bytes);
  return [...new Uint8Array(dig)].map((b) => b.toString(16).padStart(2, "0")).join("");
}

async function hmacHex(secret: string, payload: string): Promise<string> {
  const key = await crypto.subtle.importKey(
    "raw",
    new TextEncoder().encode(secret),
    { name: "HMAC", hash: "SHA-256" },
    false,
    ["sign"]
  );
  const sig = await crypto.subtle.sign("HMAC", key, new TextEncoder().encode(payload));
  return [...new Uint8Array(sig)].map((b) => b.toString(16).padStart(2, "0")).join("");
}

function timingSafeEqualHex(a: string, b: string): boolean {
  if (a.length !== b.length) return false;
  let out = 0;
  for (let i = 0; i < a.length; i++) out |= a.charCodeAt(i) ^ b.charCodeAt(i);
  return out === 0;
}
