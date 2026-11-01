import { Env } from "../env";
import { clientIp, HttpError, json, readJson, str } from "../http";
import { rateLimit } from "../ratelimit";
import { Router } from "../router";
import { requireUser } from "./guard";
import { otpauthUrl } from "./totp";
import { findUser, login, logout, refresh } from "./service";

export function authRoutes(router: Router<Env>): void {
  router.post("/v1/auth/login", async (req, env) => {
    const body = await readJson(req);
    const username = str(body, "username", { max: 64 });
    await rateLimit(env.DB, `login:${clientIp(req)}:${username}`, 10, 60);
    const password = str(body, "password", { max: 128 });
    const totp = str(body, "totp_code", { max: 12, optional: true });
    return json(await login(env, username, password, totp));
  });

  router.post("/v1/auth/refresh", async (req, env) => {
    await rateLimit(env.DB, `refresh:${clientIp(req)}`, 60, 60);
    const body = await readJson(req);
    return json(await refresh(env, str(body, "refresh_token", { max: 200 })));
  });

  router.post("/v1/auth/logout", async (req, env) => {
    const body = await readJson(req);
    const token = str(body, "refresh_token", { max: 200, optional: true });
    if (token) await logout(env, token);
    return json({ ok: true });
  });

  router.get("/v1/auth/me", async (req, env) => {
    const user = await requireUser(req, env);
    const row = await findUser(env, user.username);
    if (!row) throw new HttpError(401, "user_gone");
    return json({ id: row.id, username: row.username, totp_enabled: Boolean(row.totp_enabled) });
  });

  router.get("/v1/auth/setup-2fa", async (req, env) => {
    const user = await requireUser(req, env);
    const row = await findUser(env, user.username);
    if (!row?.totp_secret) throw new HttpError(404, "no_totp_secret");
    return json({ username: row.username, otpauth_url: otpauthUrl(row.username, row.totp_secret) });
  });
}
