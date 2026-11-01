/** Server-only environment. Never import this from a client component. */

/** Base URL of the desk API. The cloud gateway wins when one is configured. */
export function deskApiUrl(): string {
  const url =
    process.env.METADESK_CLOUD_URL ||
    process.env.METADESK_API_URL ||
    "http://127.0.0.1:8000";
  return url.replace(/\/$/, "");
}

/** Apex hostname used for host routing. Empty while the app runs on localhost. */
export function siteHost(): string {
  return (process.env.METADESK_SITE_HOST || "").trim().toLowerCase();
}

/**
 * True when the desk dials the cloud. The cloud reaches a board at
 * `/v1/devices/:id/*`; a board reached directly serves its own paths.
 */
export function deskRunsOnCloud(): boolean {
  return Boolean(process.env.METADESK_CLOUD_URL);
}
