export class HttpError extends Error {
  constructor(
    readonly status: number,
    readonly code: string,
    readonly extra: Record<string, unknown> = {},
    readonly retryable = false
  ) {
    super(code);
  }
}

export type ApiLane = "control" | "gateway" | "board" | "ops" | "health";

export function newRequestId(req?: Request): string {
  const incoming = req?.headers.get("x-request-id")?.trim();
  if (incoming && /^[A-Za-z0-9._-]{8,80}$/.test(incoming)) return incoming;
  return `req_${crypto.randomUUID().replace(/-/g, "").slice(0, 20)}`;
}

export function laneForPath(pathname: string): ApiLane {
  if (pathname === "/health") return "health";
  if (pathname.startsWith("/v1/gateway/")) return "gateway";
  if (pathname.startsWith("/v1/ops/")) return "ops";
  if (pathname.startsWith("/v1/devices/") && pathname.includes("/api/")) return "board";
  return "control";
}

export function json(data: unknown, status = 200, headers: HeadersInit = {}): Response {
  const requestId =
    (typeof headers === "object" &&
      headers &&
      "x-request-id" in (headers as Record<string, string>) &&
      (headers as Record<string, string>)["x-request-id"]) ||
    newRequestId();
  return new Response(JSON.stringify(data), {
    status,
    headers: {
      "content-type": "application/json",
      "x-request-id": String(requestId),
      ...headers,
    },
  });
}

/** Canonical success envelope for new / migrated routes. */
export function ok(
  data: unknown,
  opts: { requestId?: string; lane: ApiLane; status?: number; deviceId?: string | null }
): Response {
  const requestId = opts.requestId || newRequestId();
  return new Response(
    JSON.stringify({
      ok: true,
      data,
      meta: {
        request_id: requestId,
        lane: opts.lane,
        ...(opts.deviceId ? { device_id: opts.deviceId } : {}),
      },
    }),
    {
      status: opts.status ?? 200,
      headers: { "content-type": "application/json", "x-request-id": requestId },
    }
  );
}

export function errorResponse(
  err: unknown,
  opts?: { requestId?: string; lane?: ApiLane }
): Response {
  const requestId = opts?.requestId || newRequestId();
  const lane = opts?.lane || "control";
  if (err instanceof HttpError) {
    const payload = {
      ok: false,
      error: {
        code: err.code,
        message: humanMessage(err.code, err.extra),
        field: typeof err.extra.field === "string" ? err.extra.field : null,
        retryable: err.retryable,
      },
      meta: { request_id: requestId, lane },
      // Compat: older clients read detail.error
      detail: { error: err.code, ...err.extra },
    };
    return new Response(JSON.stringify(payload), {
      status: err.status,
      headers: { "content-type": "application/json", "x-request-id": requestId },
    });
  }
  console.error("unhandled", err instanceof Error ? err.stack : String(err));
  return new Response(
    JSON.stringify({
      ok: false,
      error: { code: "internal", message: "Internal error.", field: null, retryable: false },
      meta: { request_id: requestId, lane },
      detail: { error: "internal" },
    }),
    {
      status: 500,
      headers: { "content-type": "application/json", "x-request-id": requestId },
    }
  );
}

function humanMessage(code: string, extra: Record<string, unknown>): string {
  switch (code) {
    case "board_offline":
      return "The board is not connected to the relay.";
    case "board_timeout":
      return "The board did not answer in time.";
    case "remote_disabled":
      return "Remote access is disabled for this board.";
    case "admin_only":
      return "Admin only.";
    case "missing_field":
      return `Missing field: ${extra.field ?? "?"}.`;
    case "invalid_field":
      return `Invalid field: ${extra.field ?? "?"}.`;
    case "body_too_large":
      return "Request body is too large.";
    case "invalid_json":
      return "Body must be JSON.";
    default:
      return code.replace(/_/g, " ");
  }
}

export async function readJson(req: Request, maxBytes = 64_000): Promise<Record<string, unknown>> {
  const text = await req.text();
  if (text.length > maxBytes) throw new HttpError(413, "body_too_large");
  if (!text) return {};
  try {
    const parsed = JSON.parse(text);
    if (parsed && typeof parsed === "object" && !Array.isArray(parsed)) return parsed;
  } catch {
    // fall through
  }
  throw new HttpError(400, "invalid_json");
}

export function str(
  body: Record<string, unknown>,
  key: string,
  opts: { min?: number; max: number; optional?: boolean }
): string {
  const value = body[key];
  if (value == null || value === "") {
    if (opts.optional) return "";
    throw new HttpError(422, "missing_field", { field: key });
  }
  if (typeof value !== "string") throw new HttpError(422, "invalid_field", { field: key });
  const clean = value.trim();
  if (clean.length < (opts.min ?? 1) || clean.length > opts.max) {
    throw new HttpError(422, "invalid_length", { field: key });
  }
  return clean;
}

export function bearer(req: Request): string | null {
  const header = req.headers.get("authorization") || "";
  const match = /^Bearer\s+(.+)$/i.exec(header);
  return match ? match[1].trim() : null;
}

export function clientIp(req: Request): string {
  return req.headers.get("cf-connecting-ip") || "unknown";
}
