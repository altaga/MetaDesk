import { NextResponse } from "next/server";

export const dynamic = "force-dynamic";

export function GET(req: Request) {
  const url = new URL(req.url);
  return NextResponse.redirect(new URL("/judging", url.origin), 307);
}
