/**
 * The browser side of local board setup. The /pair wizard talks straight to an
 * unpaired board over the USB link (or a board on this same machine); the desk
 * server is not involved until the operator confirms the Pair ID.
 */

export type BoardWifi = { ssid: string; applied: boolean } | null;

export type SetupStatus = {
  ok?: boolean;
  hostname: string;
  board_emu: boolean;
  factory_id: string;
  name: string;
  has_password: boolean;
  wifi: BoardWifi;
  paired: boolean;
  pair_status: "idle" | "pending" | "paired" | "expired";
  code: string | null;
  expires_in: number | null;
  error: string | null;
};

export type SetupInput = { name: string; password: string; wifi_ssid: string; wifi_password: string };

export type FoundBoard = { base: string; status: SetupStatus };

/**
 * Where an unpaired board answers: a Jetson on the USB cable, the board-emu
 * containers on this machine (apps/board-emu), and an agent on this machine.
 */
export const SETUP_TARGETS: string[] = (
  process.env.NEXT_PUBLIC_METADESK_SETUP_TARGETS ||
  "http://192.168.55.1:8800,http://127.0.0.1:18101,http://127.0.0.1:18102,http://127.0.0.1:18103,http://127.0.0.1:8800"
)
  .split(",")
  .map((target) => target.trim().replace(/\/$/, ""))
  .filter(Boolean);

const PROBE_MS = 2500;

/**
 * From the HTTPS desk, the browser asks once for "local network access" before it
 * lets the page reach a board. Until the operator allows it, every probe fails.
 */
export function needsLocalNetworkPermission(): boolean {
  return typeof window !== "undefined" && window.location.protocol === "https:";
}

async function readSetup(base: string, init: RequestInit): Promise<SetupStatus> {
  const res = await fetch(`${base}/setup`, { ...init, mode: "cors", cache: "no-store" });
  const body = (await res.json().catch(() => ({}))) as SetupStatus & { detail?: { error?: string } };
  if (!res.ok) throw new Error(body.detail?.error || `The board answered HTTP ${res.status}.`);
  return body;
}

export async function probeBoard(base: string): Promise<FoundBoard | null> {
  const ctrl = new AbortController();
  const timer = window.setTimeout(() => ctrl.abort(), PROBE_MS);
  try {
    return { base, status: await readSetup(base, { method: "GET", signal: ctrl.signal }) };
  } catch {
    return null;
  } finally {
    window.clearTimeout(timer);
  }
}

/** Every unpaired board that answers on the known local addresses. */
export async function findLocalBoards(): Promise<FoundBoard[]> {
  const found = await Promise.all(SETUP_TARGETS.map((base) => probeBoard(base)));
  return found.filter((row): row is FoundBoard => row !== null && !row.status.paired);
}

export async function configureBoard(base: string, input: SetupInput): Promise<SetupStatus> {
  const ctrl = new AbortController();
  const timer = window.setTimeout(() => ctrl.abort(), 20_000);
  try {
    return await readSetup(base, {
      method: "POST",
      signal: ctrl.signal,
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(input),
    });
  } finally {
    window.clearTimeout(timer);
  }
}

export function boardHost(base: string): string {
  return base.replace(/^https?:\/\//, "");
}
