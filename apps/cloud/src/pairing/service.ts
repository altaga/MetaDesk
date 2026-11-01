import { randomToken, sha256Hex } from "../crypto";
import { DeviceView, boardName, deviceView } from "../devices/service";
import { Env, nowSec } from "../env";
import { HttpError } from "../http";

const CODE_TTL_SEC = 10 * 60;
const CODE_ALPHABET = "ABCDEFGHJKLMNPQRSTUVWXYZ23456789";

function newCode(): string {
  const chars = [...crypto.getRandomValues(new Uint8Array(8))].map((b) => CODE_ALPHABET[b % CODE_ALPHABET.length]);
  return `${chars.slice(0, 4).join("")}-${chars.slice(4).join("")}`;
}

export const normalizeCode = (code: string) => code.toUpperCase().replace(/[^A-Z0-9]/g, "").replace(/^(.{4})(.{4})$/, "$1-$2");

export async function startPairing(env: Env, name: string, hostname: string) {
  await env.DB.prepare("DELETE FROM pair_codes WHERE expires_at < ?1").bind(nowSec()).run();
  const code = newCode();
  const pollToken = randomToken();
  const board = boardName(name);
  await env.DB.prepare("INSERT INTO pair_codes (code, poll_hash, name, hostname, expires_at) VALUES (?1, ?2, ?3, ?4, ?5)")
    .bind(code, await sha256Hex(pollToken), board, hostname, nowSec() + CODE_TTL_SEC)
    .run();
  return { code, poll_token: pollToken, expires_in: CODE_TTL_SEC };
}

/** The signed-in user takes the board shown on the Jetson. The token is handed out on the board's next poll. */
export async function claimCode(env: Env, userId: number, code: string): Promise<DeviceView> {
  const row = await env.DB.prepare("SELECT * FROM pair_codes WHERE code = ?1")
    .bind(normalizeCode(code))
    .first<{ code: string; name: string; hostname: string | null; expires_at: number; device_id: string | null }>();
  if (!row || row.expires_at < nowSec() || row.device_id) throw new HttpError(404, "pair_code_invalid");
  const id = crypto.randomUUID();
  const created = nowSec();
  const board = boardName(row.name);
  await env.DB.batch([
    env.DB.prepare("INSERT INTO devices (id, user_id, name, hostname, created_at) VALUES (?1, ?2, ?3, ?4, ?5)").bind(
      id,
      userId,
      board,
      row.hostname,
      created
    ),
    env.DB.prepare("UPDATE pair_codes SET device_id = ?1 WHERE code = ?2").bind(id, row.code),
  ]);
  return deviceView({
    id,
    user_id: userId,
    name: board,
    hostname: row.hostname,
    remote_enabled: 1,
    connected_at: null,
    disconnected_at: null,
    created_at: created,
    board_emu: 0,
  });
}

export async function pollPairing(env: Env, pollToken: string) {
  const row = await env.DB.prepare("SELECT code, expires_at, device_id FROM pair_codes WHERE poll_hash = ?1")
    .bind(await sha256Hex(pollToken))
    .first<{ code: string; expires_at: number; device_id: string | null }>();
  if (!row) throw new HttpError(404, "pairing_unknown");
  if (!row.device_id) {
    if (row.expires_at < nowSec()) throw new HttpError(410, "pair_code_expired");
    return { status: "pending" as const };
  }
  const deviceToken = randomToken();
  await env.DB.batch([
    env.DB.prepare("UPDATE devices SET token_hash = ?1 WHERE id = ?2").bind(await sha256Hex(deviceToken), row.device_id),
    env.DB.prepare("DELETE FROM pair_codes WHERE code = ?1").bind(row.code),
  ]);
  return { status: "paired" as const, device_id: row.device_id, device_token: deviceToken };
}
