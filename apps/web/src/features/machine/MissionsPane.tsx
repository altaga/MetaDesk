"use client";

import { useState } from "react";
import type { Job } from "@/shared/types";
import { useMissions } from "./useMissions";

const LIVE: ReadonlySet<string> = new Set(["queued", "running"]);

/** Split the tasks box into one ask per non-empty line. */
function tasksFrom(text: string): string[] {
  return text
    .split("\n")
    .map((line) => line.trim())
    .filter(Boolean);
}

/** What a thread has to say right now — its answer, or why it has none yet. */
function threadText(job: Job): string {
  if (job.status === "cancelled") return job.error || "Stopped by you.";
  if (job.status === "error") return job.error || "The thread failed.";
  const answer = job.result?.answer;
  if (typeof answer === "string" && answer.trim()) return answer.trim();
  if (job.status === "running") return "Thinking…";
  if (job.status === "queued") return "Queued — waiting for a slot on the mission lane.";
  return "No answer.";
}

function indexOf(job: Job): number {
  const raw = job.payload?.index;
  return typeof raw === "number" ? raw + 1 : 0;
}

function askOf(job: Job): string {
  const raw = job.payload?.task;
  return typeof raw === "string" ? raw : "";
}

function ThreadRow({
  job,
  busy,
  onStop,
  onRemove,
}: {
  job: Job;
  busy: boolean;
  onStop: () => void;
  onRemove: () => void;
}) {
  const live = LIVE.has(job.status);
  return (
    <li className="md-mission__thread">
      <div className="md-mission__threadhead">
        <span className="md-mission__index">{indexOf(job) ? `Thread ${indexOf(job)}` : "Thread"}</span>
        <span className={`md-job__status md-job__status--${job.status}`}>{job.status}</span>
      </div>
      {askOf(job) ? <p className="md-mission__ask">{askOf(job)}</p> : null}
      <pre className="md-mission__answer">{threadText(job)}</pre>
      <div className="md-mission__actions">
        {live ? (
          <button type="button" className="md-btn md-btn--sm md-btn--ghost" disabled={busy} onClick={onStop}>
            Stop
          </button>
        ) : null}
        <button type="button" className="md-btn md-btn--sm md-btn--ghost" disabled={busy} onClick={onRemove}>
          Remove
        </button>
      </div>
    </li>
  );
}

/**
 * Missions: fork one prompt into independent turns.
 *
 * Each line in the tasks box becomes its own model turn, so several angles
 * come back side by side instead of one after another. Threads are durable
 * jobs on the mission lane: they keep running after the tab closes, and Stop
 * cancels a live one.
 */
export function MissionsPane() {
  const { missions, error, ready, busyId, liveCount, refresh, fork, stopThread, removeThread } =
    useMissions(true);
  const [prompt, setPrompt] = useState("");
  const [tasks, setTasks] = useState("");
  const [formError, setFormError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  const asks = tasksFrom(tasks);

  async function submit() {
    if (!asks.length || busy) return;
    setBusy(true);
    setFormError(null);
    try {
      await fork(asks, prompt);
      setTasks("");
    } catch (err) {
      setFormError(err instanceof Error ? err.message : "The fork could not be queued.");
    } finally {
      setBusy(false);
    }
  }

  const heading = liveCount ? `Forked · ${liveCount} running` : "Missions";
  const helper =
    asks.length > 0
      ? `${asks.length} task${asks.length === 1 ? "" : "s"} ready to fork`
      : "Type one task per line. Placeholder examples do not count.";

  return (
    <div className="md-missions">
      <p className="md-muted md-missions__note">
        Fork one prompt into independent turns that run side by side on the board. Write one task per
        line; each line becomes its own thread. Threads are durable jobs — they keep running after you
        close this tab.
      </p>

      <section className="md-missions__fork" aria-label="Fork a mission">
        <label className="md-field">
          <span className="md-label">Shared prompt (optional)</span>
          <textarea
            className="md-input md-missions__prompt"
            rows={3}
            value={prompt}
            placeholder="Same frame for every thread"
            aria-label="Shared prompt"
            onChange={(event) => setPrompt(event.target.value)}
          />
        </label>
        <label className="md-field">
          <span className="md-label">Tasks — one per line</span>
          <textarea
            className="md-input md-missions__tasks"
            rows={4}
            value={tasks}
            placeholder={"Draft the fastest safe rollout\nArgue the strictest security case\nEstimate the cost of each option"}
            aria-label="Mission tasks"
            onChange={(event) => setTasks(event.target.value)}
          />
        </label>
        <div className="md-missions__forkbar">
          <span className="md-muted md-missions__count">
            {helper}
          </span>
          <button
            type="button"
            className="md-btn md-btn--primary"
            disabled={busy || asks.length === 0}
            onClick={() => void submit()}
          >
            {busy ? "Forking…" : "Fork mission"}
          </button>
        </div>
        {formError ? (
          <p className="md-error" role="alert">
            {formError}
          </p>
        ) : null}
      </section>

      {error ? (
        <p className="md-error" role="alert">
          {error}
        </p>
      ) : null}

      {!ready ? (
        <div className="md-jobs__skeleton" aria-label="Loading missions">
          <span />
          <span />
        </div>
      ) : null}

      {ready && !error && missions.length === 0 ? (
        <p className="md-muted md-jobs__empty">
          No missions yet. Give a prompt and a few tasks above, then fork — each task runs as its own
          turn and the answers land here.
        </p>
      ) : null}

      {missions.length ? (
        <section className="md-missions__section" aria-label="Missions">
          <div className="md-jobs__sectionhead">
            <h3 className="md-jobs__title">{heading}</h3>
            <button type="button" className="md-btn md-btn--sm md-btn--ghost" onClick={() => void refresh(false)}>
              Refresh
            </button>
          </div>
          <ul className="md-missions__list">
            {missions.map((mission) => (
              <li key={mission.mission_id} className="md-mission">
                <div className="md-mission__head">
                  <span className="md-mission__id md-mono">{mission.mission_id}</span>
                  <span className="md-mission__meta">
                    {mission.threads.length} thread{mission.threads.length === 1 ? "" : "s"}
                  </span>
                </div>
                {mission.prompt ? <p className="md-mission__prompt">{mission.prompt}</p> : null}
                <ul className="md-mission__threads">
                  {mission.threads.map((thread) => (
                    <ThreadRow
                      key={thread.id}
                      job={thread}
                      busy={busyId === thread.id}
                      onStop={() => void stopThread(thread.id)}
                      onRemove={() => void removeThread(thread.id)}
                    />
                  ))}
                </ul>
              </li>
            ))}
          </ul>
        </section>
      ) : null}
    </div>
  );
}
