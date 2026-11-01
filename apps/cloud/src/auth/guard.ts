import { Env } from "../env";
import { bearer, HttpError } from "../http";
import { verifyAccess } from "./jwt";

export type AuthUser = { id: number; username: string };

export async function requireUser(req: Request, env: Env): Promise<AuthUser> {
  const token = bearer(req);
  if (!token) throw new HttpError(401, "missing_token");
  const claims = await verifyAccess(env.JWT_SECRET, token);
  if (!claims) throw new HttpError(401, "invalid_token");
  return { id: claims.sub, username: claims.usr };
}
