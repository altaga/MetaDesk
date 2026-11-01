/**
 * metadesk-meta-egress: the one hop that reaches the Meta Model API.
 *
 * From some edge regions the preview API answers model_not_found for valid
 * models, so this Worker is pinned near it (see egress.wrangler.toml) while the
 * main Worker stays close to D1 and the boards. It has no public route and holds
 * no secret: the main Worker calls it over a service binding and passes its own
 * Authorization header through.
 */

interface EgressEnv {
  META_BASE_URL: string;
}

const ALLOWED_PATHS = new Set(["/chat/completions"]);

export default {
  async fetch(req: Request, env: EgressEnv): Promise<Response> {
    const path = new URL(req.url).pathname;
    if (req.method !== "POST" || !ALLOWED_PATHS.has(path)) {
      return new Response(JSON.stringify({ detail: { error: "not_found" } }), {
        status: 404,
        headers: { "content-type": "application/json" },
      });
    }
    const headers = new Headers();
    for (const name of ["authorization", "content-type"]) {
      const value = req.headers.get(name);
      if (value) headers.set(name, value);
    }
    return fetch(`${env.META_BASE_URL.replace(/\/$/, "")}${path}`, {
      method: "POST",
      headers,
      body: req.body,
    });
  },
};
