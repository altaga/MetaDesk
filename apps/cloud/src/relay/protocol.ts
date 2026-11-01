/** Frames on the board's WebSocket. Text JSON; bodies and terminal bytes are base64. */

export type RelayUser = { id: number; username: string };

export type ToAgent =
  | { t: "req"; id: string; method: string; path: string; headers: Record<string, string>; user: RelayUser; body?: string }
  | { t: "cancel"; id: string }
  | { t: "hello_ack" }
  | { t: "beat_ack" }
  | { t: "term_open"; sid: string; cols: number; rows: number; user: RelayUser }
  | { t: "term_in"; sid: string; data: string }
  | { t: "term_resize"; sid: string; cols: number; rows: number }
  | { t: "term_close"; sid: string };

export type FromAgent =
  | { t: "hello"; version: string; hostname: string; board_emu?: boolean }
  | { t: "beat" }
  | { t: "res"; id: string; status: number; headers: Record<string, string> }
  | { t: "chunk"; id: string; b64: string }
  | { t: "end"; id: string; error?: string }
  | { t: "term_out"; sid: string; b64: string }
  | { t: "term_exit"; sid: string; code: number | null };

/** What the browser sends on a terminal socket. */
export type FromTerminal = { type: "input"; data: string } | { type: "resize"; cols: number; rows: number };

/** JSON+base64 desk uploads (~1.5 MB file → ~2.1 MB body). Keep under DO practical limits. */
export const MAX_REQUEST_BODY = 3 * 1024 * 1024;
/** First byte from the board (headers). LLM turns need headroom over a flaky link. */
export const RESPONSE_START_TIMEOUT_MS = 90_000;

export const FORWARD_REQUEST_HEADERS = [
  "content-type",
  "accept",
  "referer",
  "x-desk-preview-base",
];
