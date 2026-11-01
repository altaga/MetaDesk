import { b64url, hmacSha256, safeEqual } from "../crypto";
import { nowSec } from "../env";

export type AccessClaims = { sub: number; usr: string; exp: number };

const HEADER = b64url(new TextEncoder().encode(JSON.stringify({ alg: "HS256", typ: "JWT" })));

export async function signAccess(secret: string, userId: number, username: string, ttlSec: number): Promise<string> {
  const claims: AccessClaims = { sub: userId, usr: username, exp: nowSec() + ttlSec };
  const body = b64url(new TextEncoder().encode(JSON.stringify(claims)));
  const sig = b64url(await hmacSha256(secret, `${HEADER}.${body}`));
  return `${HEADER}.${body}.${sig}`;
}

export async function verifyAccess(secret: string, token: string): Promise<AccessClaims | null> {
  const [header, body, sig] = token.split(".");
  if (!header || !body || !sig || header !== HEADER) return null;
  const expected = b64url(await hmacSha256(secret, `${header}.${body}`));
  if (!safeEqual(expected, sig)) return null;
  try {
    const claims = JSON.parse(Buffer.from(body, "base64url").toString("utf8")) as AccessClaims;
    if (typeof claims.sub !== "number" || typeof claims.exp !== "number") return null;
    return claims.exp > nowSec() ? claims : null;
  } catch {
    return null;
  }
}
