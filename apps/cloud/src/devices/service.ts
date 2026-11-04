import { sha256Hex } from "../crypto";
import { Env } from "../env";
import { bearer, HttpError } from "../http";

/** Boards are named by the operator. Nova is only the UI guide — never a board. */
export const DEFAULT_BOARD_NAME = "Jetson";

export type DeviceRow = {
  id: string;
  user_id: number;
  name: string;
  hostname: string | null;
  remote_enabled: number;
  connected_at: number | null;
  disconnected_at: number | null;
  created_at: number;
  board_emu?: number | null;
};

export type DeviceView = {
  id: string;
  name: string;
  hostname: string;
  agent_name: string;
  kind: "jetson";
  status: "online" | "offline";
  remote_enabled: boolean;
  last_seen_at: string | null;
  agent_count: number;
  /** Docker board-emu: cloud chat only (no Auto / Local). */
  board_emu: boolean;
};

const iso = (sec: number | null) => (sec ? new Date(sec * 1000).toISOString() : null);

/** Normalize a board label; fall back to the default when the operator left it blank. */
export function boardName(name: string | null | undefined): string {
  return (name || "").trim() || DEFAULT_BOARD_NAME;
}

export function deviceView(d: DeviceRow): DeviceView {
  const online = d.connected_at != null && (d.disconnected_at == null || d.connected_at > d.disconnected_at);
  const name = boardName(d.name);
  return {
    id: d.id,
    name,
    hostname: d.hostname || "",
    agent_name: name,
    kind: "jetson",
    status: online ? "online" : "offline",
    remote_enabled: Boolean(d.remote_enabled),
    last_seen_at: iso(online ? d.connected_at : d.disconnected_at),
    agent_count: 0,
    board_emu: Boolean(d.board_emu),
  };
}

export async function listDevices(env: Env, userId: number): Promise<DeviceView[]> {
  const { results } = await env.DB.prepare(
    "SELECT * FROM devices WHERE user_id = ?1 ORDER BY created_at"
  )
    .bind(userId)
    .all<DeviceRow>();
  return results.map(deviceView);
}

/** The device, only if it belongs to this user. 404 otherwise, so ids don't leak. */
export async function ownedDevice(env: Env, userId: number, deviceId: string): Promise<DeviceRow> {
  const row = await env.DB.prepare("SELECT * FROM devices WHERE id = ?1 AND user_id = ?2 AND token_hash IS NOT NULL")
    .bind(deviceId, userId)
    .first<DeviceRow>();
  if (!row) throw new HttpError(404, "board_not_found");
  return row;
}

export async function updateDevice(
  env: Env,
  userId: number,
  deviceId: string,
  patch: { name?: string; remote_enabled?: boolean }
): Promise<DeviceView> {
  const row = await ownedDevice(env, userId, deviceId);
  const name = boardName(patch.name ?? row.name);
  const remote = patch.remote_enabled ?? Boolean(row.remote_enabled);
  await env.DB.prepare("UPDATE devices SET name = ?1, remote_enabled = ?2 WHERE id = ?3")
    .bind(name, remote ? 1 : 0, deviceId)
    .run();
  return deviceView({ ...row, name, remote_enabled: remote ? 1 : 0 });
}

export async function removeDevice(env: Env, userId: number, deviceId: string): Promise<void> {
  await ownedDevice(env, userId, deviceId);
  await env.DB.batch([
    env.DB.prepare("DELETE FROM terminal_tickets WHERE device_id = ?1").bind(deviceId),
    env.DB.prepare("DELETE FROM devices WHERE id = ?1 AND user_id = ?2").bind(deviceId, userId),
  ]);
}

/** Boards authenticate with the device token they received when paired. */
export async function requireDevice(req: Request, env: Env): Promise<DeviceRow> {
  const token = bearer(req);
  if (!token) throw new HttpError(401, "missing_device_token");
  const row = await env.DB.prepare("SELECT * FROM devices WHERE token_hash = ?1")
    .bind(await sha256Hex(token))
    .first<DeviceRow>();
  if (!row) throw new HttpError(401, "invalid_device_token");
  return row;
}

export async function markPresence(env: Env, deviceId: string, online: boolean, at: number): Promise<void> {
  const column = online ? "connected_at" : "disconnected_at";
  await env.DB.prepare(`UPDATE devices SET ${column} = ?1 WHERE id = ?2`).bind(at, deviceId).run();
}

export async function markBoardHello(
  env: Env,
  deviceId: string,
  info: { hostname: string | null; boardEmu: boolean }
): Promise<void> {
  const row = await env.DB.prepare("SELECT name, hostname FROM devices WHERE id = ?1")
    .bind(deviceId)
    .first<{ name: string; hostname: string | null }>();
  const name = boardName(row?.name);
  // The AWS Orin demo board must never stick as board-emu (that hides Terminal).
  const emu = name.trim().toLowerCase() === "orin" ? false : info.boardEmu;
  await env.DB.prepare(
    "UPDATE devices SET hostname = COALESCE(?1, hostname), board_emu = ?2, name = ?3 WHERE id = ?4"
  )
    .bind(info.hostname, emu ? 1 : 0, name, deviceId)
    .run();
}
