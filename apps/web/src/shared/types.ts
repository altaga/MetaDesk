/** Types shared by the desk surface, the BFF and the stream parser. */

export type Tier = "auto" | "local" | "fast" | "heavy" | "ultra";

/** A tier after the router has resolved it — never `auto`. */
export type ResolvedTier = Exclude<Tier, "auto">;

export type Operator = { username: string };

/** A paired board, as the cloud fleet sees it. */
export type Device = {
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

export type Health = {
  ok: boolean;
  name: string;
  version: string;
  mode: string;
  tier: string;
};

export type Session = {
  id: number;
  title: string;
  created_at: string;
  /** Optional: boards on an older API leave these out. */
  pinned?: boolean;
  /** Manual order, lower first. */
  position?: number | null;
  /** Last activity (falls back to created_at). */
  updated_at?: string | null;
  message_count?: number;
};

export type ChatRole = "user" | "assistant" | "system";

export type ChatMessage = {
  id: number;
  session_id: number;
  role: ChatRole;
  content: string;
  created_at: string;
  tier?: ResolvedTier | null;
  model?: string | null;
  tokens_in?: number | null;
  tokens_out?: number | null;
  cost_usd?: number | null;
};

/* Streaming turn events — mirror the SSE framing from the board API. */

export type RouteEvent = { tier: ResolvedTier; reason: string; model: string };
export type TokenEvent = { text: string };
export type DoneEvent = {
  tokens_in: number;
  tokens_out: number;
  cost_usd: number;
  tier: ResolvedTier;
  model: string;
};

export type ToolEntry = { name: string; type: "dir" | "file"; size: number };

export type SearchResult = { title: string; url: string; content: string };

export type ToolEvent = {
  name: "list" | "read" | "run" | "search" | "job" | string;
  status: "ok" | "error" | "blocked";
  reason?: string;
  detail?: string;
  path?: string;
  command?: string;
  exit_code?: number;
  output?: string;
  content?: string;
  truncated?: boolean;
  entries?: ToolEntry[];
  query?: string;
  results?: SearchResult[];
  dummy?: boolean;
  job?: Job;
};

export type TurnEvent =
  | { event: "route"; data: RouteEvent }
  | { event: "token"; data: TokenEvent }
  | { event: "tool"; data: ToolEvent }
  | { event: "done"; data: DoneEvent }
  /** First turn only: the name the board gave the session. */
  | { event: "title"; data: { title: string } };

/* Board telemetry. */

export type BoardInfo = {
  ok: boolean;
  hostname: string;
  platform: string;
  python: string;
  desk_root: string;
};

export type BoardHealth = {
  ok: boolean;
  cpu: { percent: number | null; count: number };
  ram: { total_mb: number; used_mb: number; percent: number };
  disk: { total_gb: number; used_gb: number; percent: number } | null;
  temp_c: number | null;
  gpu: {
    name: string;
    util_pct: number | null;
    mem_used_mb: number | null;
    mem_total_mb: number | null;
    temp_c: number | null;
  } | null;
};

/* Desk-root files. */

export type FileEntry = { name: string; type: "dir" | "file"; size: number };
export type FileListing = { ok: boolean; path: string; entries: FileEntry[] };
export type FileContent = { ok: boolean; path: string; content: string; truncated: boolean };

/* Board vault. Only names ever travel; values stay encrypted on the board. */

export type SecretName = { name: string };

/* Durable board jobs — background agents that outlive the browser tab. */

export type JobStatus = "queued" | "running" | "done" | "error" | "cancelled" | "dismissed";

export type Job = {
  id: string;
  kind: string;
  status: JobStatus;
  payload: Record<string, unknown>;
  result: Record<string, unknown>;
  error: string | null;
  notify_session_id: number | null;
  created_at: string | null;
  started_at: string | null;
  finished_at: string | null;
};

/** A desk notice: the durable inbox a finished job posts into. */
export type Notice = {
  id: number;
  job_id: string | null;
  kind: string;
  title: string;
  body: string;
  read: boolean;
  created_at: string;
};

/* Missions: one prompt forked into independent turns that run side by side. */

export type Mission = {
  mission_id: string;
  /** The shared preamble every thread was given; empty when there was none. */
  prompt: string;
  created_at: string | null;
  /** One thread per task, in fork order; each thread is an ordinary job. */
  threads: Job[];
};

/* Board browser — the desk drives a real Chromium and files what it sees. */

export type BrowserArtifact = {
  path: string;
  name: string;
  run: string;
  bytes: number;
  mtime: number;
  kind: string;
};

export type BrowserStatus = {
  playwright: boolean;
  detail: string;
  session_id: string | null;
  url: string | null;
  last_shot: string | null;
  headed: boolean;
  artifacts: BrowserArtifact[];
};

/** One browser action and its inputs, mirroring the board's request model. */
export type BrowserAction = {
  action: string;
  url?: string;
  selector?: string;
  text?: string;
  headed?: boolean;
  input?: string;
  x?: number;
  y?: number;
  dy?: number;
  key?: string;
  width?: number;
  height?: number;
};

/** The board's answer to an action; `image_b64` carries a live preview frame. */
export type BrowserResult = {
  ok: boolean;
  action?: string;
  url?: string | null;
  shot?: string | null;
  image_b64?: string;
  image_mime?: string;
  error?: string;
  reloaded?: boolean;
  title?: string;
  text?: string;
  selector?: string;
};

/* Expert profiles ("brains"): one expert is one markdown file, not notes. */

export type BrainEntry = {
  id: number;
  title: string;
  body: string;
  updated_at?: string | null;
};

export type Brain = {
  id: string;
  name: string;
  description: string;
  device_id?: string | null;
  profile?: string;
  entries?: BrainEntry[];
};

/* Shared memory: markdown files every chat on the board reads. */

export type MemoryFile = {
  id: number;
  title: string;
  content: string;
  created_at: string;
  updated_at: string;
};

/* Board terminal: a one-shot ticket buys the browser a shell on the board. */

export type TerminalTicket = {
  /** Ready to hand to `new WebSocket(...)`; carries the single-use ticket. */
  ws_url: string;
  expires_in: number;
};
