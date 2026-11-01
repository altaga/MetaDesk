/**
 * Thin HTTP client for the desk API.
 *
 * It has no browser or framework dependency: the web app points it at the
 * same-origin BFF (`/api/desk`), tests can point it straight at a board.
 */

import type {
  BoardHealth,
  BoardInfo,
  Brain,
  BrainEntry,
  BrowserAction,
  BrowserArtifact,
  BrowserResult,
  BrowserStatus,
  ChatMessage,
  Device,
  FileContent,
  FileListing,
  Health,
  Job,
  MemoryFile,
  Mission,
  Notice,
  Operator,
  SecretName,
  Session,
  TerminalTicket,
  Tier,
  TurnEvent,
} from "./types";

export type DeskClientOptions = {
  baseUrl: string;
  /** Called once when a request comes back 401; return true to retry. */
  recoverSession?: () => Promise<boolean>;
};

export class DeskError extends Error {
  constructor(
    message: string,
    readonly status: number,
  ) {
    super(message);
    this.name = "DeskError";
  }
}

const DROPPED = "The board link dropped before it could answer. It reconnects on its own.";
const LINK_CODES = new Set(["board_offline", "board_timeout", "board_reconnecting", "upstream_unreachable"]);

async function messageFrom(res: Response): Promise<string> {
  const raw = await res.text();
  try {
    const body = JSON.parse(raw) as {
      error?: { code?: string; message?: string };
      detail?: string | { error?: string };
    };
    if (body?.error?.message) {
      return LINK_CODES.has(body.error.code ?? "") ? DROPPED : body.error.message;
    }
    if (typeof body?.detail === "string") return body.detail;
    // The relay answers `{"detail":{"error":"board_timeout"}}`; never show that raw.
    const code = typeof body?.detail === "object" ? body.detail?.error : undefined;
    if (code) return LINK_CODES.has(code) ? DROPPED : `The board could not finish that (${code.replace(/_/g, " ")}).`;
    // Valid JSON with nothing readable in it: say so instead of printing the braces.
    return `The board could not answer that (HTTP ${res.status}).`;
  } catch {
    /* not an envelope — fall through to raw text */
  }
  return raw || `HTTP ${res.status}`;
}

function emitFrame(frame: string, onEvent: (event: TurnEvent) => void) {
  let name = "message";
  const data: string[] = [];
  for (const line of frame.split("\n")) {
    if (line.startsWith("event:")) name = line.slice(6).trim();
    else if (line.startsWith("data:")) data.push(line.slice(5).replace(/^ /, ""));
  }
  if (!data.length) return;
  const raw = data.join("\n");
  let parsed: unknown;
  try {
    parsed = JSON.parse(raw);
  } catch {
    parsed = { text: raw };
  }
  onEvent({ event: name, data: parsed } as TurnEvent);
}

export function createDeskClient(opts: DeskClientOptions) {
  const base = opts.baseUrl.replace(/\/$/, "");

  async function request<T>(path: string, init: RequestInit = {}, retried = false): Promise<T> {
    const headers = new Headers(init.headers ?? {});
    if (init.body && !headers.has("Content-Type")) headers.set("Content-Type", "application/json");
    const res = await fetch(`${base}${path}`, { ...init, headers, cache: "no-store" });
    if (res.status === 401 && !retried && opts.recoverSession) {
      if (await opts.recoverSession()) return request<T>(path, init, true);
    }
    if (!res.ok) throw new DeskError(await messageFrom(res), res.status);
    if (res.status === 204) return undefined as T;
    return (await res.json()) as T;
  }

  async function stream(
    path: string,
    body: unknown,
    onEvent: (event: TurnEvent) => void,
    signal?: AbortSignal,
  ) {
    const res = await fetch(`${base}${path}`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(body),
      signal,
    });
    if (!res.ok || !res.body) throw new DeskError(await messageFrom(res), res.status);
    const reader = res.body.getReader();
    const decoder = new TextDecoder();
    let buffer = "";
    for (;;) {
      const { value, done } = await reader.read();
      if (done) break;
      buffer += decoder.decode(value, { stream: true });
      let cut = buffer.indexOf("\n\n");
      while (cut !== -1) {
        emitFrame(buffer.slice(0, cut), onEvent);
        buffer = buffer.slice(cut + 2);
        cut = buffer.indexOf("\n\n");
      }
    }
  }

  return {
    health: () => request<Health>("/health"),
    me: () => request<{ ok: boolean; user: Operator }>("/v1/auth/me"),
    listDevices: () => request<Device[]>("/v1/devices"),
    claimPairing: (code: string) =>
      request<Device>("/v1/pair/claim", { method: "POST", body: JSON.stringify({ code }) }),
    boardInfo: () => request<BoardInfo>("/v1/board/info"),
    boardHealth: () => request<BoardHealth>("/v1/board/health"),
    listSessions: () => request<{ ok: boolean; sessions: Session[] }>("/v1/chat/sessions"),
    createSession: (title?: string) =>
      request<{ ok: boolean; session: Session }>("/v1/chat/sessions", {
        method: "POST",
        body: JSON.stringify({ title: title ?? null }),
      }),
    listMessages: (id: number) =>
      request<{ ok: boolean; messages: ChatMessage[] }>(`/v1/chat/sessions/${id}/messages`),
    updateSession: (id: number, patch: { title?: string; pinned?: boolean }) =>
      request<{ ok: boolean; session: Session }>(`/v1/chat/sessions/${id}`, {
        method: "PATCH",
        body: JSON.stringify(patch),
      }),
    reorderSessions: (ids: number[]) =>
      request<{ ok: boolean; sessions: Session[] }>("/v1/chat/sessions/order", {
        method: "PUT",
        body: JSON.stringify({ ids }),
      }),
    /** Delete sessions that never got a message; `keep` spares the open one. */
    deleteEmptySessions: (keep?: number | null) =>
      request<{ ok: boolean; deleted: number }>(
        `/v1/chat/sessions/empty${keep ? `?keep=${keep}` : ""}`,
        { method: "DELETE" },
      ),
    deleteSession: (id: number) =>
      request<{ ok: boolean; deleted: number }>(`/v1/chat/sessions/${id}`, { method: "DELETE" }),
    listFiles: (path = ".") =>
      request<FileListing>(`/v1/edge/files?path=${encodeURIComponent(path)}`),
    readFile: (path: string) =>
      request<FileContent>(`/v1/edge/files/read?path=${encodeURIComponent(path)}`),
    listSecrets: () => request<SecretName[]>("/v1/vault"),
    putSecret: (name: string, value: string) =>
      request<SecretName>("/v1/vault", { method: "PUT", body: JSON.stringify({ name, value }) }),
    deleteSecret: (name: string) =>
      request<{ ok: boolean }>(`/v1/vault/${encodeURIComponent(name)}`, { method: "DELETE" }),
    listJobs: (limit = 40) => request<{ jobs: Job[] }>(`/v1/jobs?limit=${limit}`),
    enqueueJob: (kind: string, payload: Record<string, unknown> = {}, notifySessionId?: number) =>
      request<Job>("/v1/jobs", {
        method: "POST",
        body: JSON.stringify({ kind, payload, notify_session_id: notifySessionId ?? null }),
      }),
    getJob: (id: string) => request<Job>(`/v1/jobs/${encodeURIComponent(id)}`),
    cancelJob: (id: string) =>
      request<Job>(`/v1/jobs/${encodeURIComponent(id)}/cancel`, { method: "POST" }),
    dismissJob: (id: string) =>
      request<{ ok: boolean; id: string; status: string }>(`/v1/jobs/${encodeURIComponent(id)}`, {
        method: "DELETE",
      }),
    listNotices: (unread = false, limit = 30) =>
      request<{ notices: Notice[]; unread: number }>(`/v1/jobs/notices?unread=${unread}&limit=${limit}`),
    readNotice: (id: number) =>
      request<Notice>(`/v1/jobs/notices/${id}/read`, { method: "POST" }),
    listMissions: (limit = 4) => request<{ missions: Mission[] }>(`/v1/missions?limit=${limit}`),
    missionThreads: (missionId: string) =>
      request<Mission>(`/v1/missions/threads?mission_id=${encodeURIComponent(missionId)}`),
    /** Fork one prompt into threads; each task runs as its own model turn. */
    forkMission: (body: { tasks: string[]; prompt?: string; notify_session_id?: number }) =>
      request<Mission>("/v1/missions/fork", { method: "POST", body: JSON.stringify(body) }),
    browserStatus: () => request<BrowserStatus>("/v1/browser/status"),
    browserArtifacts: (limit = 40) =>
      request<{ artifacts: BrowserArtifact[] }>(`/v1/browser/artifacts?limit=${limit}`),
    /** Same-origin URL for one artifact, safe to drop straight into an `<img>`. */
    browserArtifactUrl: (path: string) =>
      `${base}/v1/browser/artifacts/file?path=${encodeURIComponent(path)}`,
    browserAction: (body: BrowserAction) =>
      request<BrowserResult>("/v1/browser/action", { method: "POST", body: JSON.stringify(body) }),
    browserWarm: () =>
      request<{ ok: boolean; warm?: boolean; session_id?: string }>("/v1/browser/warm", { method: "POST" }),
    browserClose: () =>
      request<{ ok: boolean; closed: boolean; session_id?: string }>("/v1/browser/close", { method: "POST" }),
    listBrains: () => request<Brain[]>("/v1/brains"),
    createBrain: (body: {
      name: string;
      description?: string;
      method?: string;
      profile?: string;
      device_id?: string | null;
    }) => request<Brain>("/v1/brains", { method: "POST", body: JSON.stringify(body) }),
    deleteBrain: (id: string) =>
      request<{ ok: boolean }>(`/v1/brains/${encodeURIComponent(id)}`, { method: "DELETE" }),
    addBrainEntry: (id: string, body: { title?: string; body: string }) =>
      request<BrainEntry>(`/v1/brains/${encodeURIComponent(id)}/entries`, {
        method: "POST",
        body: JSON.stringify(body),
      }),
    deleteBrainEntry: (id: string, entryId: number) =>
      request<{ ok: boolean }>(`/v1/brains/${encodeURIComponent(id)}/entries/${entryId}`, {
        method: "DELETE",
      }),
    /**
     * Mint a single-use terminal ticket. The cloud owns it (the board never
     * sees the ticket); the returned `ws_url` points at the relay's terminal
     * socket and can be opened straight from the browser.
     */
    terminalTicket: (deviceId: string) =>
      request<TerminalTicket>(`/v1/devices/${encodeURIComponent(deviceId)}/terminal-ticket`, {
        method: "POST",
      }),
    listMemory: () => request<MemoryFile[]>("/v1/memory"),
    addMemory: (title: string, content: string) =>
      request<MemoryFile>("/v1/memory", { method: "POST", body: JSON.stringify({ title, content }) }),
    deleteMemory: (id: number) =>
      request<{ ok: boolean }>(`/v1/memory/${id}`, { method: "DELETE" }),
    streamTurn: (
      body: { session_id: number; text: string; tier: Tier },
      onEvent: (event: TurnEvent) => void,
      signal?: AbortSignal,
    ) => stream("/v1/chat/message/stream", body, onEvent, signal),
  };
}

export type DeskClient = ReturnType<typeof createDeskClient>;
