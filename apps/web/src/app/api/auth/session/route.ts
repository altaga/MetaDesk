import { NextResponse } from "next/server";
import {
  REFRESH_COOKIE,
  SESSION_COOKIE,
  getRefreshToken,
  getSessionToken,
  writeRefreshCookie,
  writeSessionCookie,
} from "@/lib/auth-cookie";
import { deskApiUrl } from "@/lib/server-env";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/** Fallback lifetime for a refresh token when the API does not report one. */
const DEFAULT_REFRESH_TTL_SEC = 30 * 24 * 60 * 60;

/**
 * A definitive logout also drops both cookies. Otherwise `/login` would see a
 * stale cookie and bounce straight back to the desk, in a loop.
 */
function loggedOut() {
  const res = NextResponse.json({ ok: false }, { status: 401 });
  res.cookies.delete(SESSION_COOKIE);
  res.cookies.delete(REFRESH_COOKIE);
  return res;
}

/**
 * Revalidate the stored session. Only a real 401 means "logged out".
 *
 * When the pairing is cloud-backed the access token expires long before the
 * session cookie does, so a rejected token is rotated with the refresh cookie
 * instead of ending the session.
 */
export async function POST() {
  const token = await getSessionToken();
  const refresh = await getRefreshToken();

  if (token) {
    try {
      const res = await fetch(`${deskApiUrl()}/v1/auth/me`, {
        headers: { authorization: `Bearer ${token}` },
        cache: "no-store",
      });
      if (res.ok) return NextResponse.json({ ok: true });
      if (res.status !== 401) return NextResponse.json({ ok: false }, { status: 502 });
    } catch {
      // Unreachable board is not a logout — let the caller keep the session.
      return NextResponse.json({ ok: false }, { status: 502 });
    }
  }

  if (!refresh) return loggedOut();

  try {
    const res = await fetch(`${deskApiUrl()}/v1/auth/refresh`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ refresh_token: refresh }),
      cache: "no-store",
    });
    if (res.status === 401) return loggedOut();
    if (!res.ok) return NextResponse.json({ ok: false }, { status: 502 });

    const data = (await res.json()) as {
      access_token?: string;
      refresh_token?: string;
      refresh_expires_in?: number;
    };
    if (!data.access_token) return loggedOut();

    const refreshTtl = data.refresh_expires_in ?? DEFAULT_REFRESH_TTL_SEC;
    const out = NextResponse.json({ ok: true });
    writeSessionCookie(out, data.access_token, refreshTtl);
    if (data.refresh_token) writeRefreshCookie(out, data.refresh_token, refreshTtl);
    return out;
  } catch {
    return NextResponse.json({ ok: false }, { status: 502 });
  }
}
