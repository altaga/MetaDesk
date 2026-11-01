"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { api } from "@/lib/api";
import type { Job } from "@/shared/types";

const POLL_MS = 4_000;

const LIVE: ReadonlySet<string> = new Set(["queued", "running"]);
const SETTLED: ReadonlySet<string> = new Set(["done", "error", "cancelled"]);

/**
 * Poll the board's durable job queue.
 *
 * Background agents keep running on the board after the tab closes, so this
 * poll is the only way the desk learns a job moved. A quiet refresh swallows
 * errors once a first snapshot has landed, so a blip never wipes the list.
 */
export function useBoardJobs(enabled = true) {
  const [jobs, setJobs] = useState<Job[]>([]);
  const [error, setError] = useState<string | null>(null);
  const [ready, setReady] = useState(false);
  const [busyId, setBusyId] = useState<string | null>(null);
  const seen = useRef(false);

  const refresh = useCallback(
    async (quiet = false) => {
      if (!enabled) return;
      try {
        const data = await api.listJobs(40);
        seen.current = true;
        setJobs(data.jobs ?? []);
        setError(null);
      } catch (err) {
        if (quiet && seen.current) return;
        setError(err instanceof Error ? err.message : "Jobs are unavailable.");
      } finally {
        setReady(true);
      }
    },
    [enabled],
  );

  useEffect(() => {
    if (!enabled) {
      setJobs([]);
      setError(null);
      setReady(false);
      seen.current = false;
      return;
    }
    void refresh(false);
    const timer = window.setInterval(() => void refresh(true), POLL_MS);
    return () => window.clearInterval(timer);
  }, [enabled, refresh]);

  const stopJob = useCallback(
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

  const removeJob = useCallback(async (jobId: string) => {
    setBusyId(jobId);
    try {
      await api.dismissJob(jobId);
      setJobs((prev) => prev.filter((job) => job.id !== jobId));
    } finally {
      setBusyId(null);
    }
  }, []);

  const active = jobs.filter((job) => LIVE.has(job.status));
  const recent = jobs.filter((job) => SETTLED.has(job.status));

  return { jobs, active, recent, error, ready, busyId, refresh, stopJob, removeJob };
}
