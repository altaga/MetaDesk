import { authRoutes } from "./auth/routes";
import { corsHeaders } from "./cors";
import { deviceRoutes } from "./devices/routes";
import { Env } from "./env";
import { gatewayRoutes } from "./gateway/routes";
import { guideRoutes } from "./guide/routes";
import { errorResponse, json, laneForPath, newRequestId } from "./http";
import { opsRoutes } from "./ops/routes";
import { pairingRoutes } from "./pairing/routes";
import { DeviceRelay } from "./relay/DeviceRelay";
import { relayRoutes } from "./relay/routes";
import { Router } from "./router";
import { subscriptionRoutes } from "./subscription/routes";

export { DeviceRelay };

const router = new Router<Env>();
authRoutes(router);
deviceRoutes(router);
pairingRoutes(router);
subscriptionRoutes(router);
gatewayRoutes(router);
guideRoutes(router);
opsRoutes(router);
relayRoutes(router);

function withCors(req: Request, res: Response, requestId: string): Response {
  if (res.status === 101 || res.webSocket) return res;
  const headers = new Headers(res.headers);
  for (const [key, value] of Object.entries(corsHeaders(req))) headers.set(key, value);
  if (!headers.has("x-request-id")) headers.set("x-request-id", requestId);
  return new Response(res.body, { status: res.status, statusText: res.statusText, headers });
}

export default {
  async fetch(req: Request, env: Env, ctx: ExecutionContext): Promise<Response> {
    const requestId = newRequestId(req);
    const { pathname } = new URL(req.url);
    const lane = laneForPath(pathname);
    if (req.method === "OPTIONS") {
      return new Response(null, { status: 204, headers: { ...corsHeaders(req), "x-request-id": requestId } });
    }
    try {
      if (req.method === "GET" && pathname === "/health") {
        return withCors(
          req,
          json({ ok: true, app: "MetaDesk", service: "cloud" }, 200, { "x-request-id": requestId }),
          requestId
        );
      }
      const res = await router.handle(req, env, ctx);
      return withCors(req, res, requestId);
    } catch (err) {
      return withCors(req, errorResponse(err, { requestId, lane }), requestId);
    }
  },
};
