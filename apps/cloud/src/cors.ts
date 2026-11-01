/** Strict CORS for browser→Worker. Board/server calls do not use CORS. */

const PROD_ORIGINS = new Set([
  "https://metadesk.vercel.app",
]);

function isVercelPreview(origin: string): boolean {
  try {
    const host = new URL(origin).hostname;
    return host.endsWith(".vercel.app") && host.includes("metadesk");
  } catch {
    return false;
  }
}

function isLocalDev(origin: string): boolean {
  try {
    const u = new URL(origin);
    return u.hostname === "localhost" || u.hostname === "127.0.0.1";
  } catch {
    return false;
  }
}

export function allowOrigin(origin: string | null): string | null {
  if (!origin) return null;
  if (PROD_ORIGINS.has(origin)) return origin;
  if (isVercelPreview(origin)) return origin;
  if (isLocalDev(origin)) return origin;
  return null;
}

export function corsHeaders(req: Request): Record<string, string> {
  const origin = req.headers.get("origin");
  const allowed = allowOrigin(origin);
  const headers: Record<string, string> = {
    "access-control-allow-methods": "GET, POST, PATCH, PUT, DELETE, OPTIONS",
    "access-control-allow-headers":
      "authorization, content-type, x-request-id, x-desk-timestamp, x-desk-nonce, x-desk-signature, idempotency-key",
    "access-control-expose-headers": "x-request-id, x-ratelimit-remaining, x-ratelimit-reset",
    "access-control-max-age": "86400",
    vary: "Origin",
  };
  if (allowed) {
    headers["access-control-allow-origin"] = allowed;
    headers["access-control-allow-credentials"] = "true";
  }
  return headers;
}
