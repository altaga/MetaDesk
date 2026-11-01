import { NextResponse, type NextRequest } from "next/server";
import { getSessionToken } from "@/lib/auth-cookie";
import { BOARD_COOKIE } from "@/lib/board-cookie";
import { deskApiUrl, deskRunsOnCloud } from "@/lib/server-env";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
// A chat turn can run tools on the board before it closes the stream.
export const maxDuration = 300;

type Ctx = { params: Promise<{ path: string[] }> };

/** Surfaces the board owns. Everything else on the desk API stays cloud-side. */
const BOARD_PREFIXES = [
  "/v1/board",
  "/v1/brains",
  "/v1/browser",
  "/v1/chat",
  "/v1/edge",
  "/v1/jobs",
  "/v1/memory",
  "/v1/missions",
  "/v1/ops",
  "/v1/tools",
  "/v1/vault",
];

function isBoardPath(pathname: string): boolean {
  return BOARD_PREFIXES.some((prefix) => pathname === prefix || pathname.startsWith(`${prefix}/`));
}

/**
 * The cloud only reaches a board through `/v1/devices/:id/*`, and the relay
 * hands the remainder to the board verbatim. So the board's own `/v1/chat/...`
 * becomes `/v1/devices/:id/v1/chat/...`. A board reached directly (local dev)
 * serves the path as written.
 */
function upstreamPath(path: string[], boardId: string | undefined): string {
  const joined = path.join("/");
  if (!boardId || !deskRunsOnCloud() || !isBoardPath(`/${joined}`)) return joined;
  return `v1/devices/${encodeURIComponent(boardId)}/${joined}`;
}

/**
 * The only door between the browser and the board.
 *
 * The bearer token comes from the httpOnly cookie, so the client never holds
 * it. SSE and binary responses are piped through instead of buffered.
 */
async function proxy(req: NextRequest, path: string[]) {
  const boardId = req.cookies.get(BOARD_COOKIE)?.value;
  const target = `${deskApiUrl()}/${upstreamPath(path, boardId)}${req.nextUrl.search}`;
  const headers = new Headers();
  const contentType = req.headers.get("content-type");
  if (contentType) headers.set("content-type", contentType);
  const token = await getSessionToken();
  if (token) headers.set("authorization", `Bearer ${token}`);

  const init: RequestInit = {
    method: req.method,
    headers,
    cache: "no-store",
    signal: req.signal,
  };
  if (req.method !== "GET" && req.method !== "HEAD") init.body = await req.arrayBuffer();

  try {
    const upstream = await fetch(target, init);
    const upstreamType = upstream.headers.get("content-type") ?? "";

    if (upstreamType.startsWith("text/event-stream") && upstream.body) {
      return new NextResponse(upstream.body, {
        status: upstream.status,
        headers: {
          "content-type": "text/event-stream",
          "cache-control": "no-cache, no-transform",
          "x-accel-buffering": "no",
        },
      });
    }

    const outHeaders = new Headers();
    if (upstreamType) outHeaders.set("content-type", upstreamType);
    return new NextResponse(await upstream.arrayBuffer(), {
      status: upstream.status,
      headers: outHeaders,
    });
  } catch (err) {
    const message =
      err instanceof Error && err.name === "AbortError"
        ? "The request was cancelled."
        : "The board could not be reached.";
    return NextResponse.json(
      {
        ok: false,
        error: { code: "upstream_unreachable", message, field: null, retryable: true },
        meta: { lane: "board" },
      },
      { status: 502 },
    );
  }
}

async function handle(req: NextRequest, ctx: Ctx) {
  const { path } = await ctx.params;
  return proxy(req, path);
}

export const GET = handle;
export const POST = handle;
export const PUT = handle;
export const PATCH = handle;
export const DELETE = handle;
