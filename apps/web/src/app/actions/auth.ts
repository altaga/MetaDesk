"use server";

import {
  clearRefreshCookie,
  clearSessionCookie,
  getRefreshToken,
  setRefreshCookie,
  setSessionCookie,
} from "@/lib/auth-cookie";
import { deskApiUrl } from "@/lib/server-env";

export type LoginResult = { ok: true } | { ok: false; error: string };

/** Fallback lifetime for a refresh token when the API does not report one. */
const DEFAULT_REFRESH_TTL_SEC = 30 * 24 * 60 * 60;

async function readError(res: Response): Promise<string> {
  const raw = await res.text();
  try {
    const body = JSON.parse(raw) as { error?: { message?: string } };
    if (body?.error?.message) return body.error.message;
  } catch {
    /* not an envelope */
  }
  return raw || `Login failed (${res.status}).`;
}

/**
 * Exchange operator credentials for a session token and keep it in an httpOnly
 * cookie. The token is never returned to the browser as JSON.
 *
 * The cloud Worker answers with `access_token` / `refresh_token`; the board with
 * a single `token`. Both shapes are accepted.
 */
export async function loginAction(username: string, password: string): Promise<LoginResult> {
  try {
    const res = await fetch(`${deskApiUrl()}/v1/auth/login`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ username, password }),
      cache: "no-store",
    });
    if (!res.ok) return { ok: false, error: await readError(res) };

    const data = (await res.json()) as {
      token?: string;
      access_token?: string;
      refresh_token?: string;
      expires_in?: number;
      refresh_expires_in?: number;
    };
    const accessToken = data.access_token ?? data.token;
    if (!accessToken) return { ok: false, error: "Login response carried no token." };

    const refreshTtl = data.refresh_expires_in ?? DEFAULT_REFRESH_TTL_SEC;
    // With a refresh token the session cookie must outlive the access token, or
    // `/api/auth/session` could never rotate it. The BFF re-checks on every call.
    await setSessionCookie(accessToken, data.refresh_token ? refreshTtl : data.expires_in ?? 3600);
    if (data.refresh_token) await setRefreshCookie(data.refresh_token, refreshTtl);
    return { ok: true };
  } catch {
    // The fetch itself failed: nothing answered at the desk API address.
    return { ok: false, error: "The desk could not reach the board. Check that it is online, then try again." };
  }
}

export async function logoutAction(): Promise<void> {
  const refresh = await getRefreshToken();
  if (refresh) {
    // Best effort: revoke the refresh token so it cannot be replayed.
    try {
      await fetch(`${deskApiUrl()}/v1/auth/logout`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ refresh_token: refresh }),
        cache: "no-store",
      });
    } catch {
      /* cookies are cleared regardless */
    }
  }
  await clearSessionCookie();
  await clearRefreshCookie();
}
