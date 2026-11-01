import { requireUser } from "../auth/guard";
import { Env } from "../env";
import { json } from "../http";
import { Router } from "../router";
import { balance } from "./service";

export function subscriptionRoutes(router: Router<Env>): void {
  router.get("/v1/subscription", async (req, env) => {
    const user = await requireUser(req, env);
    return json(await balance(env, user.id));
  });
}
