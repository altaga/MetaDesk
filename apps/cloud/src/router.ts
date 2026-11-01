import { errorResponse, json } from "./http";

type Params = Record<string, string>;
export type Handler<E> = (req: Request, env: E, ctx: ExecutionContext, params: Params) => Promise<Response>;

type Route<E> = { method: string; pattern: RegExp; keys: string[]; handler: Handler<E> };

/** Path patterns: `/v1/devices/:id`, and a trailing `*` captures the rest as `rest`. */
export class Router<E> {
  private routes: Route<E>[] = [];

  private add(method: string, path: string, handler: Handler<E>): void {
    const keys: string[] = [];
    const source = path
      .split("/")
      .map((part) => {
        if (part === "*") {
          keys.push("rest");
          return "(.*)";
        }
        if (part.startsWith(":")) {
          keys.push(part.slice(1));
          return "([^/]+)";
        }
        return part.replace(/[.+?^${}()|[\]\\]/g, "\\$&");
      })
      .join("/");
    this.routes.push({ method, pattern: new RegExp(`^${source}$`), keys, handler });
  }

  get(path: string, h: Handler<E>) { this.add("GET", path, h); }
  post(path: string, h: Handler<E>) { this.add("POST", path, h); }
  patch(path: string, h: Handler<E>) { this.add("PATCH", path, h); }
  delete(path: string, h: Handler<E>) { this.add("DELETE", path, h); }
  any(path: string, h: Handler<E>) { this.add("*", path, h); }

  async handle(req: Request, env: E, ctx: ExecutionContext): Promise<Response> {
    const { pathname } = new URL(req.url);
    for (const route of this.routes) {
      if (route.method !== "*" && route.method !== req.method) continue;
      const match = route.pattern.exec(pathname);
      if (!match) continue;
      const params: Params = {};
      route.keys.forEach((key, i) => (params[key] = decodeURIComponent(match[i + 1] ?? "")));
      try {
        return await route.handler(req, env, ctx, params);
      } catch (err) {
        return errorResponse(err);
      }
    }
    return json({ detail: { error: "not_found" } }, 404);
  }
}
