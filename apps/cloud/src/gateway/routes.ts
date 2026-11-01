import { requireDevice } from "../devices/service";
import { Env } from "../env";
import { HttpError, json } from "../http";
import { rateLimit } from "../ratelimit";
import { Router } from "../router";
import { balance } from "../subscription/service";
import { assertGatewayHmac } from "./hmac";
import { proxyMeta } from "./meta";
import { tavilySearch } from "./tavily";

async function readBody(req: Request, maxBytes: number): Promise<{ raw: ArrayBuffer; json: Record<string, unknown> }> {
  const raw = await req.arrayBuffer();
  if (raw.byteLength > maxBytes) throw new HttpError(413, "body_too_large");
  if (!raw.byteLength) return { raw, json: {} };
  try {
    const parsed = JSON.parse(new TextDecoder().decode(raw));
    if (parsed && typeof parsed === "object" && !Array.isArray(parsed)) return { raw, json: parsed };
  } catch {
    /* fall through */
  }
  throw new HttpError(400, "invalid_json");
}

/** Boards call these with their device token. Provider keys never leave the cloud. */
export function gatewayRoutes(router: Router<Env>): void {
  router.post("/v1/gateway/meta/chat/completions", async (req, env, ctx) => {
    const device = await requireDevice(req, env);
    await rateLimit(env.DB, `gw-meta:${device.id}`, 120, 60);
    const { raw, json: body } = await readBody(req, 2_000_000);
    await assertGatewayHmac(req, env, raw);
    return proxyMeta(env, ctx, device, body);
  });

  router.post("/v1/gateway/search", async (req, env) => {
    const device = await requireDevice(req, env);
    await rateLimit(env.DB, `gw-search:${device.id}`, 30, 60);
    const { raw, json: body } = await readBody(req, 64_000);
    await assertGatewayHmac(req, env, raw);
    return json(await tavilySearch(env, device, body));
  });

  router.get("/v1/gateway/balance", async (req, env) => {
    const device = await requireDevice(req, env);
    await assertGatewayHmac(req, env, null);
    return json(await balance(env, device.user_id));
  });
}
