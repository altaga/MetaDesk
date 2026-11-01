"use client";

import { useState } from "react";
import type { Device } from "@/shared/types";
import { Icon } from "@/ui/Icon";

/**
 * "Pair a new board": the setup wizard for a Jetson on the USB cable, and a code
 * box for a board that already has a pairing code.
 */
export function AddJetson({
  devices,
  onClaim,
  onSetup,
}: {
  devices: Device[];
  onClaim: (code: string) => Promise<Device>;
  onSetup: () => void;
}) {
  const [code, setCode] = useState("");
  const [claiming, setClaiming] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [joined, setJoined] = useState<string | null>(null);

  async function claim(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const value = code.trim().toUpperCase();
    if (value.replace(/[^A-Z0-9]/g, "").length < 8) {
      setError("Enter the 8-character code shown on the board.");
      return;
    }
    setClaiming(true);
    setError(null);
    try {
      const device = await onClaim(value);
      setJoined(device.name);
      setCode("");
    } catch (err) {
      setError(err instanceof Error ? err.message : "That code did not pair.");
    } finally {
      setClaiming(false);
    }
  }

  return (
    <aside className="md-card md-addjetson" aria-label="Pair a new board" data-guide="pair">
      <header className="md-addjetson__head">
        <h2>Pair a new board</h2>
        <p className="md-muted">
          {devices.length ? "Add another Jetson to this account." : "Add your first Jetson. No terminal needed."}
        </p>
      </header>

      <button type="button" className="md-btn md-btn--primary md-addjetson__setup" onClick={onSetup}>
        <Icon name="board" size={18} />
        Set up a board
      </button>
      <p className="md-addjetson__note">
        Plug the Jetson into this computer with the USB cable. The wizard finds it, sets its name, password and Wi-Fi,
        and asks you to confirm its Pair ID.
      </p>

      <div className="md-addjetson__or">
        <span>or enter a code</span>
      </div>

      <form className="md-addjetson__form" onSubmit={(event) => void claim(event)}>
        <input
          className="md-input md-mono"
          value={code}
          onChange={(event) => setCode(event.target.value.toUpperCase())}
          placeholder="ABCD-EFGH"
          aria-label="Pairing code"
          autoComplete="off"
          autoCapitalize="characters"
          spellCheck={false}
        />
        <button className="md-btn md-btn--primary" type="submit" disabled={claiming || code.trim().length < 8}>
          {claiming ? "Pairing…" : "Pair"}
        </button>
      </form>
      {error ? (
        <p className="md-error" role="alert">
          {error}
        </p>
      ) : null}
      {joined ? (
        <div className="md-addjetson__done" role="status">
          <strong>{joined} joined the fleet.</strong>
        </div>
      ) : null}
    </aside>
  );
}
