"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { api } from "@/lib/api";
import type { ChatMessage, Session, Tier, ToolEvent, TurnEvent } from "@/shared/types";

export type ToolRun = ToolEvent & { key: string };

export type Turn = {
  id: string;
  role: "user" | "assistant";
  text: string;
  tier?: string | null;
  model?: string | null;
  tools: ToolRun[];
  costUsd?: number | null;
  tokensIn?: number | null;
  tokensOut?: number | null;
  streaming?: boolean;
  /** The tier the operator asked for; the router may have picked another. */
  requested?: Tier;
  /** Why the turn ran somewhere other than where it was asked to. */
  note?: string;
  /** The operator stopped the reply before it finished. */
  stopped?: boolean;
};

/** A plain explanation when the router could not honour the tier. */
function routeNote(reason: string, requested: Tier | undefined): string | undefined {
  const cloud = requested === "fast" || requested === "heavy" || requested === "ultra";
  if (reason === "no_meta_key_fallback_local" && requested !== "local") {
    return "Cloud tiers are off: this board is not paired to the cloud, so this ran locally.";
  }
  if (reason === "daily_budget_exhausted") return "Today's cloud budget is spent, so this ran locally.";
  if (reason === "mode_local_only" && cloud) return "This board is in local-only mode, so this ran locally.";
  if (reason === "mode_cloud_only_remap" && requested === "local") {
    return "This board is cloud-only, so this ran on the fast tier.";
  }
  return undefined;
}

function readError(err: unknown): string {
  return err instanceof Error ? err.message : "Something went wrong.";
}

function fromMessage(message: ChatMessage): Turn {
  return {
    id: `srv-${message.id}`,
    role: message.role === "user" ? "user" : "assistant",
    text: message.content,
    tier: message.tier ?? null,
    model: message.model ?? null,
    tools: [],
    costUsd: message.cost_usd ?? null,
    tokensIn: message.tokens_in ?? null,
    tokensOut: message.tokens_out ?? null,
  };
}

let counter = 0;
function localId(prefix: string): string {
  counter += 1;
  return `${prefix}-${Date.now()}-${counter}`;
}

function lastStreaming(turns: Turn[]): number {
  for (let index = turns.length - 1; index >= 0; index -= 1) {
    if (turns[index].role === "assistant" && turns[index].streaming) return index;
  }
  return -1;
}

function applyEvent(turns: Turn[], event: TurnEvent): Turn[] {
  const index = lastStreaming(turns);
  if (index === -1) return turns;

  const turn: Turn = { ...turns[index] };
  if (event.event === "route") {
    turn.tier = event.data.tier;
    turn.model = event.data.model;
    turn.note = routeNote(event.data.reason, turn.requested);
  } else if (event.event === "token") {
    turn.text += event.data.text;
  } else if (event.event === "tool") {
    turn.tools = [...turn.tools, { ...event.data, key: localId("tool") }];
  } else if (event.event === "done") {
    turn.tier = event.data.tier;
    turn.model = event.data.model;
    turn.costUsd = event.data.cost_usd;
    turn.tokensIn = event.data.tokens_in;
    turn.tokensOut = event.data.tokens_out;
    turn.streaming = false;
  }

  const next = [...turns];
  next[index] = turn;
  return next;
}

/** The board's title for a session nobody has named yet. */
export const DEFAULT_TITLE = "New session";

/** Sessions, the transcript of the active one, and the streaming turn state. */
export function useChatSession() {
  const [sessions, setSessions] = useState<Session[]>([]);
  const [activeId, setActiveId] = useState<number | null>(null);
  const [turns, setTurns] = useState<Turn[]>([]);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const activeRef = useRef<number | null>(null);
  const abortRef = useRef<AbortController | null>(null);
  const sessionsRef = useRef<Session[]>([]);
  useEffect(() => {
    sessionsRef.current = sessions;
  }, [sessions]);

  const loadSessions = useCallback(async () => {
    try {
      const res = await api.listSessions();
      setSessions(res.sessions);
      return res.sessions;
    } catch (err) {
      setError(readError(err));
      return [];
    }
  }, []);

  const openSession = useCallback(async (id: number) => {
    activeRef.current = id;
    setActiveId(id);
    setError(null);
    try {
      const res = await api.listMessages(id);
      // A quicker click on another session wins over this slower answer.
      if (activeRef.current !== id) return;
      setTurns(res.messages.map(fromMessage));
    } catch (err) {
      if (activeRef.current !== id) return;
      setError(readError(err));
      setTurns([]);
    }
  }, []);

  useEffect(() => {
    void (async () => {
      const list = await loadSessions();
      if (list.length) await openSession(list[0].id);
    })();
  }, [loadSessions, openSession]);

  /** Open a blank chat. An untouched one already in the list is reused, so empties don't pile up. */
  const newSession = useCallback(async () => {
    const blank = sessionsRef.current.find(
      (item) => item.message_count === 0 && !item.pinned && item.title === DEFAULT_TITLE,
    );
    if (blank) {
      activeRef.current = blank.id;
      setActiveId(blank.id);
      setTurns([]);
      setError(null);
      return blank.id;
    }
    const res = await api.createSession();
    setSessions((prev) => [{ message_count: 0, ...res.session }, ...prev]);
    activeRef.current = res.session.id;
    setActiveId(res.session.id);
    setTurns([]);
    setError(null);
    return res.session.id;
  }, []);

  /** Change a session right away; put it back if the board refuses. */
  const updateSession = useCallback(async (id: number, patch: { title?: string; pinned?: boolean }) => {
    const before = sessionsRef.current.find((item) => item.id === id);
    if (!before) return;
    setSessions((prev) => prev.map((item) => (item.id === id ? { ...item, ...patch } : item)));
    try {
      const res = await api.updateSession(id, patch);
      setSessions((prev) => prev.map((item) => (item.id === id ? { ...item, ...res.session } : item)));
    } catch (err) {
      setSessions((prev) => prev.map((item) => (item.id === id ? before : item)));
      setError(readError(err));
    }
  }, []);

  const renameSession = useCallback(
    async (id: number, title: string) => {
      const clean = title.trim();
      if (clean) await updateSession(id, { title: clean });
    },
    [updateSession],
  );

  const pinSession = useCallback(
    (id: number, pinned: boolean) => updateSession(id, { pinned }),
    [updateSession],
  );

  /** Save a manual order (top first); the list follows at once and reloads if the board refuses. */
  const reorderSessions = useCallback(
    async (ids: number[]) => {
      const rank = new Map(ids.map((id, index) => [id, index]));
      setSessions((prev) =>
        prev.map((item) => (rank.has(item.id) ? { ...item, position: rank.get(item.id) } : item)),
      );
      try {
        const res = await api.reorderSessions(ids);
        setSessions(res.sessions);
      } catch (err) {
        setError(readError(err));
        void loadSessions();
      }
    },
    [loadSessions],
  );

  /** Remove every session that never got a message, except the open one. */
  const clearEmptySessions = useCallback(async () => {
    try {
      const res = await api.deleteEmptySessions(activeRef.current);
      await loadSessions();
      return res.deleted;
    } catch (err) {
      setError(readError(err));
      return 0;
    }
  }, [loadSessions]);

  const removeSession = useCallback(
    async (id: number) => {
      try {
        await api.deleteSession(id);
      } catch (err) {
        setError(readError(err));
        return;
      }
      const remaining = sessions.filter((item) => item.id !== id);
      setSessions(remaining);
      if (activeRef.current === id) {
        if (remaining.length) await openSession(remaining[0].id);
        else {
          activeRef.current = null;
          setActiveId(null);
          setTurns([]);
        }
      }
    },
    [sessions, openSession],
  );

  const send = useCallback(
    async (text: string, tier: Tier) => {
      const clean = text.trim();
      if (!clean || busy) return;

      setError(null);
      let sessionId = activeRef.current;
      if (sessionId === null) sessionId = await newSession();

      setTurns((prev) => [
        ...prev,
        { id: localId("user"), role: "user", text: clean, tools: [] },
        { id: localId("assistant"), role: "assistant", text: "", tools: [], streaming: true, requested: tier },
      ]);
      setBusy(true);

      const controller = new AbortController();
      abortRef.current = controller;
      try {
        await api.streamTurn(
          { session_id: sessionId, text: clean, tier },
          (event) => {
            if (event.event === "title") {
              const { title } = event.data;
              setSessions((prev) => prev.map((item) => (item.id === sessionId ? { ...item, title } : item)));
            } else {
              setTurns((prev) => applyEvent(prev, event));
            }
          },
          controller.signal,
        );
      } catch (err) {
        if (!controller.signal.aborted) setError(readError(err));
      } finally {
        const stopped = controller.signal.aborted;
        setTurns((prev) =>
          prev.map((turn) => (turn.streaming ? { ...turn, streaming: false, stopped } : turn)),
        );
        setBusy(false);
        abortRef.current = null;
        void loadSessions();
      }
    },
    [busy, newSession, loadSessions],
  );

  const cancel = useCallback(() => {
    abortRef.current?.abort();
  }, []);

  return {
    sessions,
    activeId,
    turns,
    busy,
    error,
    send,
    cancel,
    openSession,
    newSession,
    removeSession,
    renameSession,
    pinSession,
    reorderSessions,
    clearEmptySessions,
    refreshSessions: loadSessions,
  };
}
