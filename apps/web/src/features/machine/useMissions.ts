"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { api } from "@/lib/api";
import type { Mission } from "@/shared/types";

const POLL_MS = 4_000;

/** Threads still waiting on the board's mission lane. */
const LIVE: ReadonlySet<string> = new Set(["queued", "running"]);

/**
 * Poll the operator's recent missions.
 *
 * A mission is a group of durable jobs, so the same rules as the Agents tab
 * apply: the turns keep running after the tab closes and this poll is the only
 * way the desk learns one moved. A quiet refresh swallows errors once a first
 * snapshot has landed, so a blip never wipes the board.
 */
export function useMissions(enabled = true, limit = 4) {
  const [missions, setMissions] = useState<Mission[]>([]);
  const [error, setError] = useState<string | null>(null);
  const [ready, setReady] = useState(false);
  const [busyId, setBusyId] = useState<string | null>(null);
  const seen = useRef(false);

  const refresh = useCallback(
    async (quiet = false) => {
      if (!enabled) return;
      try {
        const data = await api.listMissions(limit);
        seen.current = true;
        setMissions(data.missions ?? []);
        setError(null);
      } catch (err) {
        if (quiet && seen.current) return;
        setError(err instanceof Error ? err.message : "Missions are unavailable.");
      } finally {
        setReady(true);
      }
    },
    [enabled, limit],
  );

  useEffect(() => {
    if (!enabled) {
      setMissions([]);
      setError(null);
      setReady(false);
      seen.current = false;
      return;
    }
    void refresh(false);
    const timer = window.setInterval(() => void refresh(true), POLL_MS);
    return () => window.clearInterval(timer);
  }, [enabled, refresh]);

  const fork = useCallback(
    async (tasks: string[], prompt?: string) => {
      const mission = await api.forkMission({ tasks, prompt: prompt || undefined });
      await refresh(true);
      return mission;
    },
    [refresh],
  );

  const stopThread = useCallback(
    async (jobId: string) => {
      setBusyId(jobId);
      try {
        await api.cancelJob(jobId);
        await refresh(true);
      } finally {
        setBusyId(null);
      }
    },
    [refresh],
  );

  const removeThread = useCallback(
    async (jobId: string) => {
      setBusyId(jobId);
      try {
        await api.dismissJob(jobId);
        await refresh(true);
      } finally {
        setBusyId(null);
      }
    },
    [refresh],
  );

  const liveCount = missions.reduce(
    (total, mission) => total + mission.threads.filter((thread) => LIVE.has(thread.status)).length,
    0,
  );

  return { missions, error, ready, busyId, liveCount, refresh, fork, stopThread, removeThread };
}
