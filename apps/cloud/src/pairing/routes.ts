import { requireUser } from "../auth/guard";
import { Env } from "../env";
import { clientIp, json, readJson, str } from "../http";
import { rateLimit } from "../ratelimit";
import { Router } from "../router";
import { claimCode, pollPairing, startPairing } from "./service";

export function pairingRoutes(router: Router<Env>): void {
  router.post("/v1/pair/start", async (req, env) => {
    await rateLimit(env.DB, `pair-start:${clientIp(req)}`, 10, 600);
    const body = await readJson(req);
    const name = str(body, "name", { max: 120, optional: true }) || "Jetson";
    const hostname = str(body, "hostname", { max: 120, optional: true });
    return json(await startPairing(env, name, hostname));
  });

  router.post("/v1/pair/poll", async (req, env) => {
    await rateLimit(env.DB, `pair-poll:${clientIp(req)}`, 60, 60);
    const body = await readJson(req);
    return json(await pollPairing(env, str(body, "poll_token", { max: 200 })));
  });

  router.post("/v1/pair/claim", async (req, env) => {
    const user = await requireUser(req, env);
    await rateLimit(env.DB, `pair-claim:${user.id}`, 10, 600);
    const body = await readJson(req);
    return json(await claimCode(env, user.id, str(body, "code", { min: 8, max: 12 })));
  });

}
