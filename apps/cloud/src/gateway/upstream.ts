import { Env } from "../env";

/**
 * POST a chat completion to the Meta Model API with the Worker's key.
 *
 * Goes through the META_EGRESS service binding when it is bound, so the call
 * leaves from the region the egress Worker is pinned to; local dev without the
 * binding fetches Meta directly.
 */
export function metaChatCompletions(env: Env, body: unknown): Promise<Response> {
  const init: RequestInit = {
    method: "POST",
    headers: { authorization: `Bearer ${env.META_API_KEY}`, "content-type": "application/json" },
    body: JSON.stringify(body),
  };
  if (env.META_EGRESS) return env.META_EGRESS.fetch("https://meta-egress.internal/chat/completions", init);
  return fetch(`${env.META_BASE_URL.replace(/\/$/, "")}/chat/completions`, init);
}
