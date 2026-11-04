import { NextResponse } from "next/server";

export const dynamic = "force-dynamic";

/** Evaluator entry alias — redirects to the canonical secret path. */
export function GET(req: Request) {
  const url = new URL(req.url);
  return NextResponse.redirect(new URL("/judges", url.origin), 307);
}
