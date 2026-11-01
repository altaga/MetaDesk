"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { api } from "@/lib/api";
import type { MemoryFile } from "@/shared/types";
import { memoryFact, memoryFileName } from "@/shared/memoryFile";

type Props = {
  /** Bump to force a reload (e.g. after a `/memory` command from chat). */
  version?: number;
};

function message(err: unknown, fallback: string): string {
  return err instanceof Error ? err.message : fallback;
}

/**
 * Shared memory. Every fact here is injected into every chat on the board, so
 * it is the place for things that should always be true, not a scratchpad.
 */
export function MemoryCard({ version = 0 }: Props) {
  const [entries, setEntries] = useState<MemoryFile[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [name, setName] = useState("");
  const [draft, setDraft] = useState("");
  const [open, setOpen] = useState<number | null>(null);
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
      .listMemory()
      .then((rows) => setEntries(rows))
      .catch((err) => setError(message(err, "Memory is unavailable.")))
      .finally(() => setLoading(false));
  }, []);

  useEffect(() => {
    reload();
  }, [reload, version]);

  function save() {
    const title = name.trim();
    const content = draft.trim();
    if (!title || !content) return;
    setError(null);
    const tempId = -Date.now();
    const previous = entries;
    setEntries([{ id: tempId, title, content, created_at: "", updated_at: "" }, ...previous]);
    setName("");
    setDraft("");
    flashSaved();
    void api
      .addMemory(title, content)
      .then((row) => {
        setEntries((current) => current.map((entry) => (entry.id === tempId ? row : entry)));
      })
      .catch((err) => {
        setEntries(previous);
        setSaved(false);
        setError(message(err, "Could not save the memory."));
      });
  }

  function remove(memoryId: number) {
    const previous = entries;
    setEntries(previous.filter((entry) => entry.id !== memoryId));
    if (open === memoryId) setOpen(null);
    setError(null);
    void api.deleteMemory(memoryId).catch((err) => {
      setEntries(previous);
      setError(message(err, "Could not remove the memory."));
    });
  }

  return (
    <section className="md-card md-memory" aria-label="Shared memory" data-guide="memory">
      <header className="md-memory__head">
        <h2>Shared memory</h2>
        <span className="md-chip">{entries.length}</span>
      </header>
      <p className="md-muted md-memory__note">
        Facts every chat on this board reads. Use it for things that should always be true.
      </p>

      {loading ? <div className="md-slot">Loading…</div> : null}
      {!loading && entries.length === 0 ? <div className="md-slot">No memory files yet.</div> : null}

      {entries.length > 0 ? (
        <ul className="md-memory__list">
          {entries.map((entry) => (
            <li key={entry.id} className="md-memory__item">
              <div className="md-memory__row">
                <button
                  type="button"
                  className="md-memory__toggle"
                  disabled={entry.id < 0}
                  aria-expanded={open === entry.id}
                  title={open === entry.id ? "Show the fact only" : "Show the whole file"}
                  onClick={() => setOpen((current) => (current === entry.id ? null : entry.id))}
                >
                  <span className="md-mono">{memoryFileName(entry.title || "memory")}</span>
                </button>
                <button
                  type="button"
                  className="md-btn md-btn--sm md-btn--ghost"
                  disabled={entry.id < 0}
                  aria-label={`Remove ${memoryFileName(entry.title || "memory")}`}
                  onClick={() => remove(entry.id)}
                >
                  Remove
                </button>
              </div>
              {open === entry.id ? (
                <pre className="md-code md-memory__file" aria-label={`${memoryFileName(entry.title || "memory")} contents`}>
                  {entry.content}
                </pre>
              ) : (
                <p className="md-memory__fact">{memoryFact(entry.content)}</p>
              )}
            </li>
          ))}
        </ul>
      ) : null}

      <form
        className="md-memory__form"
        onSubmit={(event) => {
          event.preventDefault();
          save();
        }}
      >
        <input
          className="md-input"
          value={name}
          placeholder="Name"
          aria-label="New memory name"
          autoComplete="off"
          onChange={(event) => setName(event.target.value)}
        />
        <input
          className="md-input"
          value={draft}
          placeholder="A fact this board should remember"
          aria-label="New shared memory fact"
          autoComplete="off"
          onChange={(event) => setDraft(event.target.value)}
        />
        <button className="md-btn md-btn--primary" type="submit" disabled={(!name.trim() || !draft.trim()) && !saved}>
          {saved ? "Saved" : "Save"}
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
