import { requireUser } from "../auth/guard";
import { Env } from "../env";
import { HttpError, json, readJson, str } from "../http";
import { Router } from "../router";
import { listDevices, removeDevice, requireDevice, updateDevice } from "./service";

export function deviceRoutes(router: Router<Env>): void {
  router.get("/v1/devices", async (req, env) => {
    const user = await requireUser(req, env);
    return json(await listDevices(env, user.id));
  });

  router.patch("/v1/devices/:id", async (req, env, _ctx, { id }) => {
    const user = await requireUser(req, env);
    const body = await readJson(req);
    const patch: { name?: string; remote_enabled?: boolean } = {};
    if ("name" in body) patch.name = str(body, "name", { max: 120 });
    if ("remote_enabled" in body) {
      if (typeof body.remote_enabled !== "boolean") throw new HttpError(422, "invalid_field", { field: "remote_enabled" });
      patch.remote_enabled = body.remote_enabled;
    }
    return json(await updateDevice(env, user.id, id, patch));
  });

  router.delete("/v1/devices/:id", async (req, env, _ctx, { id }) => {
    const user = await requireUser(req, env);
    await removeDevice(env, user.id, id);
    return json({ ok: true as const });
  });

  /** The board renames itself (from its own desk) so the picker stays in sync. */
  router.patch("/v1/board/self", async (req, env) => {
    const device = await requireDevice(req, env);
    const body = await readJson(req);
    return json(await updateDevice(env, device.user_id, device.id, { name: str(body, "name", { max: 120 }) }));
  });
}
