"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { api } from "@/lib/api";
import type { Brain } from "@/shared/types";
import { profileAngle, profileMethod } from "./profileFile";

type Props = {
  /** Prefills the composer with `@Name ` when the operator picks an expert. */
  onUse?: (prompt: string) => void;
};

function message(err: unknown, fallback: string): string {
  return err instanceof Error ? err.message : fallback;
}

/** The markdown an optimistic row shows before the board answers. */
function draftProfile(angle: string, method: string): string {
  const lines = ["## Angle", angle];
  if (method) lines.push("", "## Method", method);
  return lines.join("\n");
}

/**
 * Expert profiles. Each one is a single agent the operator can call with
 * `@Name` — a brain is not a place to collect notes.
 */
export function ExpertsCard({ onUse }: Props) {
  const [brains, setBrains] = useState<Brain[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [name, setName] = useState("");
  const [angle, setAngle] = useState("");
  const [method, setMethod] = useState("");
  const [saved, setSaved] = useState(false);
  const savedTimer = useRef<ReturnType<typeof setTimeout> | null>(null);

  useEffect(
    () => () => {
      if (savedTimer.current) clearTimeout(savedTimer.current);
    },
    [],
  );

  function flashSaved() {
    setSaved(true);
    if (savedTimer.current) clearTimeout(savedTimer.current);
    savedTimer.current = setTimeout(() => setSaved(false), 1200);
  }

  const reload = useCallback(() => {
    setError(null);
    api
      .listBrains()
      .then((rows) => setBrains(rows))
      .catch((err) => setError(message(err, "Experts are unavailable.")))
      .finally(() => setLoading(false));
  }, []);

  useEffect(() => {
    reload();
  }, [reload]);

  function create() {
    const clean = name.trim();
    const nextAngle = angle.trim();
    const nextMethod = method.trim();
    if (!clean || !nextAngle) return;
    setError(null);
    const tempId = `pending-${Date.now()}`;
    const previous = brains;
    setBrains([
      ...previous,
      { id: tempId, name: clean, description: nextAngle, profile: draftProfile(nextAngle, nextMethod) },
    ]);
    setName("");
    setAngle("");
    setMethod("");
    flashSaved();
    void api
      .createBrain({ name: clean, description: nextAngle, method: nextMethod })
      .then((row) => {
        setBrains((current) =>
          current.map((brain) =>
            brain.id === tempId
              ? { ...brain, id: row.id, name: row.name, profile: row.profile, description: nextAngle }
              : brain,
          ),
        );
      })
      .catch((err) => {
        setBrains(previous);
        setSaved(false);
        setError(message(err, "Could not save the expert."));
      });
  }

  function remove(brainId: string) {
    const previous = brains;
    setBrains(previous.filter((brain) => brain.id !== brainId));
    setError(null);
    void api.deleteBrain(brainId).catch((err) => {
      setBrains(previous);
      setError(message(err, "Could not remove the expert."));
    });
  }

  return (
    <section className="md-card md-expert" aria-label="Expert profiles" data-guide="experts">
      <header className="md-expert__head">
        <h2>Experts</h2>
        <span className="md-chip">{brains.length}</span>
      </header>
      <p className="md-muted md-expert__note">
        One expert is one profile: an angle and a method. Call one in chat by writing{" "}
        <span className="md-mono">@Name</span>.
      </p>

      {loading ? <div className="md-slot">Loading…</div> : null}
      {!loading && brains.length === 0 ? <div className="md-slot">No experts yet.</div> : null}

      {brains.length > 0 ? (
        <ul className="md-expert__list">
          {brains.map((brain) => {
            const brainAngle = profileAngle(brain.profile, brain.description);
            const brainMethod = profileMethod(brain.profile);
            const pending = brain.id.startsWith("pending-");
            return (
              <li key={brain.id} className="md-expert__item">
                <div className="md-expert__row">
                  <span className="md-expert__name">{brain.name}</span>
                  <code className="md-mono">@{brain.name}</code>
                  <button
                    type="button"
                    className="md-btn md-btn--sm md-btn--ghost"
                    aria-label={`Use ${brain.name} in chat`}
                    onClick={() => onUse?.(`@${brain.name} `)}
                  >
                    Use
                  </button>
                  <button
                    type="button"
                    className="md-btn md-btn--sm md-btn--ghost"
                    disabled={pending}
                    aria-label={`Delete ${brain.name}`}
                    onClick={() => remove(brain.id)}
                  >
                    Delete
                  </button>
                </div>
                <p className="md-expert__angle">{brainAngle || "No angle yet."}</p>
                {brainMethod ? <p className="md-expert__method">{brainMethod}</p> : null}
              </li>
            );
          })}
        </ul>
      ) : null}

      <form
        className="md-expert__form"
        onSubmit={(event) => {
          event.preventDefault();
          create();
        }}
      >
        <input
          className="md-input"
          value={name}
          placeholder="Expert name"
          aria-label="Expert name"
          autoComplete="off"
          onChange={(event) => setName(event.target.value)}
        />
        <input
          className="md-input"
          value={angle}
          placeholder="Angle on the work"
          aria-label="Expert angle"
          autoComplete="off"
          onChange={(event) => setAngle(event.target.value)}
        />
        <textarea
          className="md-input md-expert__methodbox"
          value={method}
          placeholder="How they would do it"
          aria-label="Expert method"
          rows={2}
          onChange={(event) => setMethod(event.target.value)}
        />
        <button className="md-btn md-btn--primary" type="submit" disabled={(!name.trim() || !angle.trim()) && !saved}>
          {saved ? "Saved" : "Add expert"}
        </button>
      </form>

      {error ? (
        <p className="md-error" role="alert">
          {error}
        </p>
      ) : null}
    </section>
  );
}
