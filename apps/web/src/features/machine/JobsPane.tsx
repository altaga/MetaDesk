"use client";

import { useMemo } from "react";
import type { Job } from "@/shared/types";
import { useBoardJobs } from "./useBoardJobs";

const KIND_LABEL: Record<string, string> = {
  research: "Research agent",
  verify: "Verify agent",
  probe: "Probe agent",
  health: "Health agent",
  deploy: "Deploy agent",
  checks: "Checks agent",
  bakeoff: "Bakeoff agent",
  record: "Screen recorder",
  shell: "Shell agent",
};

const RUNNING_COPY: Record<string, string> = {
  research: "Deep research on the board…",
  bakeoff: "Comparing targets on the board…",
  deploy: "Deploying on the board…",
  checks: "Running checks on the board…",
  record: "Recording on the board's Chromium…",
};

function labelKind(kind: string): string {
  return KIND_LABEL[kind] ?? `${kind} agent`;
}

function str(value: unknown): string | null {
  return typeof value === "string" && value ? value : null;
}

/** One line that tells the operator what this agent was asked to do. */
function detailOf(job: Job): string {
  if (job.status === "cancelled") return job.error || "Stopped by you.";
  if (job.status === "error") return job.error || "The agent failed.";
  const payload = job.payload ?? {};
  const topic = str(payload.topic);
  if (topic) return topic;
  const command = str(payload.command);
  if (command) return command;
  const target = str(payload.target);
  if (target) return target;
  const url = str(payload.url);
  if (url) return url;
  if (typeof payload.repeats === "number") return `repeats: ${payload.repeats}`;
  if (job.status === "done") {
    const result = job.result ?? {};
    const path = str(result.path);
    if (path) return path;
    if (typeof result.pass_rate === "number") return `pass rate ${Math.round(result.pass_rate * 100)}%`;
    if (result.ok === true) return "Completed on the board.";
  }
  if (job.status === "running") return RUNNING_COPY[job.kind] ?? "Working on the board…";
  if (job.status === "queued") return "Queued — waiting for the board worker.";
  return "";
}

function stamp(job: Job): string {
  const raw = job.finished_at || job.started_at || job.created_at;
  if (!raw) return "";
  const at = new Date(raw);
  return Number.isNaN(at.getTime()) ? "" : at.toLocaleTimeString();
}

function JobRow({
  job,
  busy,
  onStop,
  onRemove,
}: {
  job: Job;
  busy: boolean;
  onStop?: () => void;
  onRemove: () => void;
}) {
  const live = job.status === "queued" || job.status === "running";
  const detail = detailOf(job);
  return (
    <li className="md-job">
      <div className="md-job__head">
        <span className="md-job__kind">{labelKind(job.kind)}</span>
        <span className={`md-job__status md-job__status--${job.status}`}>{job.status}</span>
      </div>
      {detail ? <p className="md-job__detail">{detail}</p> : null}
      <div className="md-job__foot">
        {stamp(job) ? <span className="md-job__time">{stamp(job)}</span> : <span />}
        <div className="md-job__actions">
          {live && onStop ? (
            <button type="button" className="md-btn md-btn--sm md-btn--ghost" disabled={busy} onClick={onStop}>
              Stop
            </button>
          ) : null}
          <button type="button" className="md-btn md-btn--sm md-btn--ghost" disabled={busy} onClick={onRemove}>
            Remove
          </button>
        </div>
      </div>
    </li>
  );
}

/**
 * Background agents on the board.
 *
 * These are durable jobs: they keep running after the browser closes and post
 * the result into chat. Stop cancels a live agent; Remove clears it from here.
 */
export function JobsPane() {
  const { active, recent, error, ready, busyId, refresh, stopJob, removeJob } = useBoardJobs(true);

  const heading = useMemo(
    () => (active.length ? `Active · ${active.length}` : "No active agents"),
    [active.length],
  );

  return (
    <div className="md-jobs">
      <p className="md-muted md-jobs__note">
        Background agents keep running on the board after you close this tab and report the result in
        chat when they finish. Stop cancels a live agent; Remove clears it from this list.
      </p>

      {error ? (
        <p className="md-error" role="alert">
          {error}
        </p>
      ) : null}

      {!ready ? (
        <div className="md-jobs__skeleton" aria-label="Loading background agents">
          <span />
          <span />
        </div>
      ) : null}

      {ready && !error && active.length === 0 && recent.length === 0 ? (
        <p className="md-muted md-jobs__empty">
          No background agents yet. Ask in chat to “start a deep research on Jetson edge agents in the
          background and ping me when the report is ready”, then watch this tab.
        </p>
      ) : null}

      {active.length ? (
        <section className="md-jobs__section" aria-label="Active agents">
          <h3 className="md-jobs__title">{heading}</h3>
          <ul className="md-jobs__list">
            {active.map((job) => (
              <JobRow
                key={job.id}
                job={job}
                busy={busyId === job.id}
                onStop={() => void stopJob(job.id)}
                onRemove={() => void removeJob(job.id)}
              />
            ))}
          </ul>
        </section>
      ) : null}

      {recent.length ? (
        <section className="md-jobs__section" aria-label="Recent agents">
          <div className="md-jobs__sectionhead">
            <h3 className="md-jobs__title">Recent</h3>
            <button type="button" className="md-btn md-btn--sm md-btn--ghost" onClick={() => void refresh(false)}>
              Refresh
            </button>
          </div>
          <ul className="md-jobs__list">
            {recent.map((job) => (
              <JobRow key={job.id} job={job} busy={busyId === job.id} onRemove={() => void removeJob(job.id)} />
            ))}
          </ul>
        </section>
      ) : null}
    </div>
  );
}
