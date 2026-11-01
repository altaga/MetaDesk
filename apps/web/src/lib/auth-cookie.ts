import { cookies } from "next/headers";
import type { NextResponse } from "next/server";

/**
 * The session token lives in an httpOnly cookie so no script can read it.
 * It never travels to the browser as JSON — only the BFF forwards it upstream.
 *
 * The cloud also hands back a refresh token; it lives in its own httpOnly
 * cookie so the BFF can rotate the session without a re-login. A board-only
 * deployment never sets it, and nothing breaks.
 */
export const SESSION_COOKIE = "metadesk_token";
export const REFRESH_COOKIE = "metadesk_refresh";

function cookieOptions(maxAgeSec: number) {
  return {
    httpOnly: true,
    secure: process.env.NODE_ENV === "production",
    sameSite: "lax" as const,
    path: "/",
    maxAge: maxAgeSec,
  };
}

export async function setSessionCookie(token: string, maxAgeSec: number): Promise<void> {
  const jar = await cookies();
  jar.set(SESSION_COOKIE, token, cookieOptions(maxAgeSec));
}

export async function clearSessionCookie(): Promise<void> {
  const jar = await cookies();
  jar.delete(SESSION_COOKIE);
}

export async function getSessionToken(): Promise<string | null> {
  const jar = await cookies();
  return jar.get(SESSION_COOKIE)?.value ?? null;
}

/** Attach the session cookie to a response the BFF is about to return. */
export function writeSessionCookie(res: NextResponse, token: string, maxAgeSec: number): void {
  res.cookies.set(SESSION_COOKIE, token, cookieOptions(maxAgeSec));
}

export async function setRefreshCookie(token: string, maxAgeSec: number): Promise<void> {
  const jar = await cookies();
  jar.set(REFRESH_COOKIE, token, cookieOptions(maxAgeSec));
}

export async function clearRefreshCookie(): Promise<void> {
  const jar = await cookies();
  jar.delete(REFRESH_COOKIE);
}

export async function getRefreshToken(): Promise<string | null> {
  const jar = await cookies();
  return jar.get(REFRESH_COOKIE)?.value ?? null;
}

/** Attach the refresh cookie to a response the BFF is about to return. */
export function writeRefreshCookie(res: NextResponse, token: string, maxAgeSec: number): void {
  res.cookies.set(REFRESH_COOKIE, token, cookieOptions(maxAgeSec));
}
