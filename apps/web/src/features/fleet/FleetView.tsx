"use client";

import { useState } from "react";
import { AddJetson } from "@/features/fleet/AddJetson";
import type { Device } from "@/shared/types";

/** "12s ago" — enough to tell a live board from a stale one. */
function ago(iso: string | null): string {
  if (!iso) return "never seen";
  const then = Date.parse(iso);
  if (Number.isNaN(then)) return "never seen";
  const secs = Math.max(0, Math.round((Date.now() - then) / 1000));
  if (secs < 60) return `${secs}s ago`;
  if (secs < 3600) return `${Math.round(secs / 60)}m ago`;
  if (secs < 86400) return `${Math.round(secs / 3600)}h ago`;
  return `${Math.round(secs / 86400)}d ago`;
}

function BoardRow({
  device,
  active,
  busy,
  onSelect,
}: {
  device: Device;
  active: boolean;
  busy: boolean;
  onSelect: (id: string) => void;
}) {
  const dot = device.status === "online" ? "md-status__dot--on" : "md-status__dot--off";
  return (
    <button
      className={`md-board ${active ? "md-board--active" : ""}`}
      onClick={() => onSelect(device.id)}
      disabled={busy}
      aria-pressed={active}
    >
      <span className={`md-status__dot ${dot}`} />
      <span className="md-board__body">
        <span className="md-board__name">{device.name}</span>
        <span className="md-board__meta md-mono">{device.hostname || device.id}</span>
      </span>
      <span className="md-board__side">
        <span className="md-chip">{device.status}</span>
        {device.board_emu ? <span className="md-chip">emu</span> : null}
        {device.remote_enabled ? null : <span className="md-chip">remote off</span>}
        {active ? <span className="md-chip md-chip--fast">active</span> : null}
        {/* Online boards report when they connected; offline ones, when they dropped. */}
        <span className="md-muted md-board__seen">
          {device.last_seen_at
            ? `${device.status === "online" ? "connected" : "seen"} ${ago(device.last_seen_at)}`
            : ago(null)}
        </span>
      </span>
    </button>
  );
}

/**
 * The fleet: every board paired to this account, and the code entry that takes
 * a fresh one. Picking a board is what decides where chat, files and telemetry
 * are routed.
 */
export function FleetView({
  devices,
  activeId,
  onSelect,
  onClaim,
  onSetup,
}: {
  devices: Device[] | null;
  activeId: string | null;
  onSelect: (id: string) => Promise<void>;
  onClaim: (code: string) => Promise<Device>;
  /** Open the board setup wizard inside Fleet. */
  onSetup: () => void;
}) {
  const [selecting, setSelecting] = useState(false);
  const [selectError, setSelectError] = useState<string | null>(null);

  async function pick(id: string) {
    if (id === activeId) return;
    setSelecting(true);
    setSelectError(null);
    try {
      await onSelect(id);
    } catch (err) {
      setSelectError(err instanceof Error ? err.message : "Could not switch to that board.");
    } finally {
      setSelecting(false);
    }
  }

  return (
    <>
      <div className="md-viewhead">
        <h1>Fleet</h1>
        <span className="md-muted">The desk drives the board you pick here.</span>
      </div>

      {devices === null ? (
        <article className="md-card md-fleet__note">
          <p>
            The fleet lives in the cloud. This desk talks to a board directly, so there is
            nothing to pair from here.
          </p>
        </article>
      ) : (
        <div className="md-fleet">
          <section className="md-fleet__list" data-guide="fleet">
            {devices.length === 0 ? (
              <article className="md-card md-fleet__note">
                <p>No boards yet. Set up your first Jetson with the wizard.</p>
              </article>
            ) : (
              devices.map((device) => (
                <BoardRow
                  key={device.id}
                  device={device}
                  active={device.id === activeId}
                  busy={selecting}
                  onSelect={(id) => void pick(id)}
                />
              ))
            )}
            {selectError ? (
              <p className="md-error" role="alert">
                {selectError}
              </p>
            ) : null}
          </section>

          <AddJetson devices={devices} onClaim={onClaim} onSetup={onSetup} />
        </div>
      )}
    </>
  );
}
