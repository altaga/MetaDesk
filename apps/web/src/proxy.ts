import { NextResponse, type NextRequest } from "next/server";

const LOCAL = new Set(["localhost", "127.0.0.1"]);
/** Paths the app serves directly instead of redirecting. */
const APP_PATHS = new Set(["/", "/login", "/dashboard", "/pair", "/judges", "/judge", "/judging"]);

function hostnameOf(req: NextRequest): string {
  return (req.headers.get("host") || "").split(":")[0].toLowerCase();
}

function relocate(req: NextRequest, pathname: string, host?: string) {
  const url = req.nextUrl.clone();
  url.pathname = pathname;
  url.search = "";
  if (host) {
    url.protocol = "https:";
    url.hostname = host;
    url.port = "";
  }
  return NextResponse.redirect(url);
}

/**
 * Host routing only. When no apex host is configured the app serves the
 * landing and the desk from the same origin, which is how local dev works.
 */
export function proxy(req: NextRequest) {
  const { pathname } = req.nextUrl;
  if (
    pathname.startsWith("/_next") ||
    pathname.startsWith("/api") ||
    pathname.startsWith("/brand") ||
    /\.[a-z0-9]+$/i.test(pathname)
  ) {
    return NextResponse.next();
  }
  if (req.method !== "GET" && req.method !== "HEAD") return NextResponse.next();

  const site = (process.env.METADESK_SITE_HOST || "").trim().toLowerCase();
  const host = hostnameOf(req);

  if (!site || LOCAL.has(host)) {
    return APP_PATHS.has(pathname) ? NextResponse.next() : relocate(req, "/");
  }

  if (host === `app.${site}`) {
    return APP_PATHS.has(pathname) ? NextResponse.next() : relocate(req, "/dashboard");
  }

  if (host !== site) return relocate(req, "/", site);
  return pathname === "/" ? NextResponse.next() : relocate(req, "/");
}

export const config = {
  matcher: ["/((?!_next/static|_next/image).*)"],
};
