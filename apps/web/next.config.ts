import type { NextConfig } from "next";

/**
 * The desk surface is a single Next app.
 *
 * The browser only ever talks to same-origin BFF routes under `/api/desk/*`.
 * Upstream board credentials live in httpOnly cookies that JS cannot read, so
 * no secret is ever bundled into the client.
 */
const nextConfig: NextConfig = {
  reactStrictMode: true,
  poweredByHeader: false,
};

export default nextConfig;
