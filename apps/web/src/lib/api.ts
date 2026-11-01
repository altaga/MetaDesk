import { createDeskClient } from "@/shared/client";
import { ensureSession } from "@/lib/session";

/**
 * The browser only ever talks to the same-origin BFF (`/api/desk/...`).
 * The upstream board URL and the bearer token stay on the server.
 */
export const api = createDeskClient({
  baseUrl: "/api/desk",
  recoverSession: ensureSession,
});
