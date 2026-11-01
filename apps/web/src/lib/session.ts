"use client";

let inflight: Promise<boolean> | null = null;

/**
 * Revalidate the httpOnly session against the board.
 *
 * A network failure is not a logout — only an explicit 401 is, so a flaky
 * link never kicks the operator out of the desk.
 */
export function ensureSession(): Promise<boolean> {
  if (!inflight) {
    inflight = probe().finally(() => {
      inflight = null;
    });
  }
  return inflight;
}

async function probe(): Promise<boolean> {
  try {
    const res = await fetch("/api/auth/session", { method: "POST", cache: "no-store" });
    return res.status !== 401;
  } catch {
    return true;
  }
}
