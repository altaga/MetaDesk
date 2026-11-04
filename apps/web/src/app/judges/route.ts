import { NextResponse } from "next/server";
import { BOARD_COOKIE } from "@/lib/board-cookie";
import { deskApiUrl } from "@/lib/server-env";

export const dynamic = "force-dynamic";

/** Known AWS Orin board id — used only when the fleet list is briefly unavailable. */
const FALLBACK_ORIN_ID = "a6dd3900-0cf9-4bbb-b3d3-4b255f0b01bc";
const ORIN_NAME = "orin";
const DEFAULT_REFRESH_TTL_SEC = 30 * 24 * 60 * 60;
const SESSION_COOKIE = "metadesk_token";
const REFRESH_COOKIE = "metadesk_refresh";

type DeviceRow = {
  id: string;
  name: string;
  status: "online" | "offline" | string;
};

function cookieOptions(maxAgeSec: number) {
  return {
    httpOnly: true,
    secure: process.env.NODE_ENV === "production",
    sameSite: "lax" as const,
    path: "/",
    maxAge: maxAgeSec,
  };
}

function asDeviceList(payload: unknown): DeviceRow[] {
  if (Array.isArray(payload)) return payload as DeviceRow[];
  if (payload && typeof payload === "object" && Array.isArray((payload as { devices?: unknown }).devices)) {
    return (payload as { devices: DeviceRow[] }).devices;
  }
  return [];
}

function pickOrin(devices: DeviceRow[]): DeviceRow | null {
  const named = devices.filter((d) => (d.name || "").trim().toLowerCase() === ORIN_NAME);
  if (!named.length) return null;
  return named.find((d) => d.status === "online") ?? named[0];
}

/**
 * 1-click evaluator bypass: mint a session against the Cloudflare Worker and
 * bind the desk to the AWS Orin board (the VM running MetaDesk), then land on
 * /dashboard. Never binds local board-emu containers.
 */
export async function GET(req: Request) {
  const url = new URL(req.url);
  const deskUrl = deskApiUrl();
  const username = process.env.BOOTSTRAP_USERNAME || "admin";
  const password = process.env.BOOTSTRAP_PASSWORD || "f0xkqTsH7VFOesh70ynsDoSv";

  if (!process.env.METADESK_CLOUD_URL && !deskUrl.includes("workers.dev")) {
    return renderFallbackHtml(
      "Cloud gateway not configured",
      "Set METADESK_CLOUD_URL to the MetaDesk Worker so the evaluator desk can reach the demo board.",
      url.origin
    );
  }

  try {
    const loginRes = await fetch(`${deskUrl}/v1/auth/login`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ username, password }),
      cache: "no-store",
    });

    if (!loginRes.ok) {
      const errText = await loginRes.text();
      return renderFallbackHtml(
        "Authentication Failed",
        `Could not mint evaluator credentials (${loginRes.status}): ${errText}`,
        url.origin
      );
    }

    const data = (await loginRes.json()) as {
      access_token?: string;
      token?: string;
      refresh_token?: string;
      expires_in?: number;
      refresh_expires_in?: number;
    };

    const accessToken = data.access_token ?? data.token;
    if (!accessToken) {
      return renderFallbackHtml(
        "Token Missing",
        "API authenticated successfully but did not issue an access token.",
        url.origin
      );
    }

    const refreshTtl = data.refresh_expires_in ?? DEFAULT_REFRESH_TTL_SEC;
    const sessionTtl = data.refresh_token ? refreshTtl : data.expires_in ?? 3600;

    let targetDeviceId = FALLBACK_ORIN_ID;
    let orinStatus: string = "unknown";

    try {
      const devRes = await fetch(`${deskUrl}/v1/devices`, {
        headers: { Authorization: `Bearer ${accessToken}` },
        cache: "no-store",
      });
      if (devRes.ok) {
        const devices = asDeviceList(await devRes.json());
        const orin = pickOrin(devices);
        if (!orin) {
          return renderFallbackHtml(
            "Orin board not found",
            "No fleet device named “orin” is paired to this account. Pair the AWS VM first, then retry.",
            url.origin
          );
        }
        targetDeviceId = orin.id;
        orinStatus = orin.status;
        if (orin.status !== "online") {
          return renderFallbackHtml(
            "Orin is offline",
            `The AWS Orin board (${orin.id}) is paired but not connected to the relay right now. Wait for the agent to dial out, then retry.`,
            url.origin
          );
        }
      }
    } catch {
      // Keep FALLBACK_ORIN_ID so a transient fleet list failure still opens the desk.
      orinStatus = "fallback";
    }

    const res = NextResponse.redirect(new URL("/dashboard", req.url), 307);
    res.cookies.set(SESSION_COOKIE, accessToken, cookieOptions(sessionTtl));
    if (data.refresh_token) {
      res.cookies.set(REFRESH_COOKIE, data.refresh_token, cookieOptions(refreshTtl));
    }
    res.cookies.set(BOARD_COOKIE, targetDeviceId, {
      path: "/",
      maxAge: 60 * 60 * 24 * 365,
      sameSite: "lax",
    });
    res.headers.set("X-MetaDesk-Judge-Board", targetDeviceId);
    res.headers.set("X-MetaDesk-Judge-Status", orinStatus);
    return res;
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    return renderFallbackHtml(
      "Connection Error",
      `The desk API could not be reached: ${message}`,
      url.origin
    );
  }
}

function renderFallbackHtml(title: string, details: string, origin: string): Response {
  const html = `<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="utf-8">
  <meta name="viewport" content="width=device-width, initial-scale=1">
  <title>${title} · MetaDesk</title>
  <style>
    :root {
      --bg: #0b0d10;
      --surface: #14181f;
      --border: #232936;
      --text: #f0f3f8;
      --muted: #8b95a5;
      --accent: #38bdf8;
      --danger: #ef4444;
      --font-sans: -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, "Helvetica Neue", sans-serif;
      --font-mono: ui-monospace, SFMono-Regular, Menlo, Monaco, Consolas, monospace;
    }
    * { box-sizing: border-box; margin: 0; padding: 0; }
    body {
      background: var(--bg);
      color: var(--text);
      font-family: var(--font-sans);
      display: flex;
      align-items: center;
      justify-content: center;
      min-height: 100vh;
      padding: 1.5rem;
    }
    .card {
      width: 100%;
      max-width: 480px;
      background: var(--surface);
      border: 1px solid var(--border);
      border-radius: 4px;
      padding: 2rem;
    }
    .badge {
      display: inline-flex;
      align-items: center;
      gap: 0.5rem;
      font-family: var(--font-mono);
      font-size: 0.75rem;
      text-transform: uppercase;
      letter-spacing: 0.05em;
      color: var(--danger);
      background: rgba(239, 68, 68, 0.1);
      border: 1px solid rgba(239, 68, 68, 0.25);
      padding: 0.25rem 0.6rem;
      border-radius: 9999px;
      margin-bottom: 1.25rem;
    }
    h1 {
      font-size: 1.25rem;
      font-weight: 600;
      letter-spacing: -0.02em;
      margin-bottom: 0.75rem;
    }
    p {
      color: var(--muted);
      font-size: 0.875rem;
      line-height: 1.5;
      margin-bottom: 1.5rem;
      word-break: break-word;
    }
    .actions { display: flex; gap: 0.75rem; }
    .btn {
      display: inline-flex;
      align-items: center;
      justify-content: center;
      font-size: 0.875rem;
      font-weight: 500;
      padding: 0.6rem 1.25rem;
      border-radius: 2px;
      text-decoration: none;
      transition: background 0.15s ease;
    }
    .btn-primary { background: var(--text); color: var(--bg); }
    .btn-primary:hover { background: #ffffff; }
    .btn-secondary {
      background: transparent;
      color: var(--text);
      border: 1px solid var(--border);
    }
    .btn-secondary:hover { border-color: var(--muted); }
    :focus-visible { outline: 2px solid var(--accent); outline-offset: 2px; }
  </style>
</head>
<body>
  <main class="card" role="alert">
    <div class="badge"><span>●</span><span>Evaluator Bypass Notice</span></div>
    <h1>${title}</h1>
    <p>${details}</p>
    <div class="actions">
      <a href="." class="btn btn-primary">Retry Access</a>
      <a href="${origin}/login" class="btn btn-secondary">Sign In Manually</a>
    </div>
  </main>
</body>
</html>`;

  return new Response(html, {
    status: 502,
    headers: { "Content-Type": "text/html; charset=utf-8" },
  });
}
