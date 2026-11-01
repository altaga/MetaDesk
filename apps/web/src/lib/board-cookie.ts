/**
 * Which board the desk drives. The value is a device id — not a secret — so it
 * lives in a plain cookie the client writes and the BFF reads to pick the
 * upstream route. Server components may import the name; only the browser
 * touches `document`.
 */
export const BOARD_COOKIE = "metadesk_board";

/** A year is plenty: the id is stable for the life of the pairing. */
const MAX_AGE_SEC = 60 * 60 * 24 * 365;

export function readBoardId(): string | null {
  if (typeof document === "undefined") return null;
  for (const part of document.cookie.split("; ")) {
    if (part.startsWith(`${BOARD_COOKIE}=`)) {
      return decodeURIComponent(part.slice(BOARD_COOKIE.length + 1)) || null;
    }
  }
  return null;
}

export function writeBoardId(id: string): void {
  document.cookie = `${BOARD_COOKIE}=${encodeURIComponent(id)}; path=/; max-age=${MAX_AGE_SEC}; samesite=lax`;
}
