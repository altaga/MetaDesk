import { NextResponse } from "next/server";

export const dynamic = "force-dynamic";

/** Canonical judge entry — same bypass as /judges. */
export function GET(req: Request) {
  const url = new URL(req.url);
  return NextResponse.redirect(new URL("/judges", url.origin), 307);
}
