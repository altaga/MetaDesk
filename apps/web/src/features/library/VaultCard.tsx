"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { api } from "@/lib/api";

function message(err: unknown, fallback: string): string {
  return err instanceof Error ? err.message : fallback;
}

/** Same rule as the board: a portable shell variable name. */
const NAME_RE = /^[A-Za-z_][A-Za-z0-9_]{0,63}$/;

/**
 * The board keychain. Names are usable as environment variables by the chat
 * tools and the shell; the stored values can never be read back through the UI.
 */
export function VaultCard() {
  const [names, setNames] = useState<string[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [name, setName] = useState("");
  const [value, setValue] = useState("");
  const [saved, setSaved] = useState(false);
  // A secret about to be removed; its value can never be recovered, so ask first.
  const [confirming, setConfirming] = useState<string | null>(null);
  const savedTimer = useRef<ReturnType<typeof setTimeout> | null>(null);

  useEffect(
    () => () => {
      if (savedTimer.current) clearTimeout(savedTimer.current);
    },
    [],
  );

  const flashSaved = useCallback(() => {
    setSaved(true);
    if (savedTimer.current) clearTimeout(savedTimer.current);
    savedTimer.current = setTimeout(() => setSaved(false), 1200);
  }, []);

  const reload = useCallback(() => {
    setError(null);
    api
      .listSecrets()
      .then((rows) => setNames(rows.map((row) => row.name)))
      .catch((err) => setError(message(err, "Secrets are unavailable.")))
      .finally(() => setLoading(false));
  }, []);

  useEffect(() => {
    reload();
  }, [reload]);

  function save() {
    const clean = name.trim();
    const secret = value;
    if (!clean || !secret) return;
    if (!NAME_RE.test(clean)) {
      setError("Use letters, digits and underscores, not starting with a digit, like GITHUB_TOKEN.");
      return;
    }
    setError(null);
    const previous = names;
    setNames(previous.includes(clean) ? previous : [...previous, clean]);
    setName("");
    setValue("");
    flashSaved();
    void api.putSecret(clean, secret).catch((err) => {
      setNames(previous);
      setSaved(false);
      // Give the operator their input back so a fix is one edit away.
      setName(clean);
      setValue(secret);
      setError(message(err, "Could not save the secret."));
    });
  }

  function remove(item: string) {
    setConfirming(null);
    const previous = names;
    setNames(previous.filter((row) => row !== item));
    setError(null);
    void api.deleteSecret(item).catch((err) => {
      setNames(previous);
      setError(message(err, "Could not remove the secret."));
    });
  }

  return (
    <section className="md-card md-vault" aria-label="Execution secrets" data-guide="secrets">
      <header className="md-vault__head">
        <h2>Execution secrets</h2>
        <span className="md-chip">{names.length}</span>
      </header>
      <p className="md-muted md-vault__note">
        Keychain for the board: chats and the shell can use these names as environment variables, but
        the values can never be read back.
      </p>

      {loading ? <div className="md-slot">Loading…</div> : null}
      {!loading && names.length === 0 ? <div className="md-slot">No secrets stored yet.</div> : null}

      {names.length > 0 ? (
        <ul className="md-vault__list">
          {names.map((item) => (
            <li key={item}>
              <code className="md-vault__name">{item}</code>
              {confirming === item ? (
                <span className="md-vault__confirm" role="group" aria-label={`Remove ${item}?`}>
                  <span className="md-muted">Remove for good?</span>
                  <button type="button" className="md-btn md-btn--sm md-btn--ghost" autoFocus onClick={() => setConfirming(null)}>
                    Keep
                  </button>
                  <button type="button" className="md-btn md-btn--sm md-btn--danger" onClick={() => remove(item)}>
                    Remove
                  </button>
                </span>
              ) : (
                <button
                  type="button"
                  className="md-btn md-btn--sm md-btn--ghost"
                  aria-label={`Remove ${item}`}
                  onClick={() => setConfirming(item)}
                >
                  Remove
                </button>
              )}
            </li>
          ))}
        </ul>
      ) : null}

      <form
        className="md-vault__form"
        onSubmit={(event) => {
          event.preventDefault();
          save();
        }}
      >
        <input
          className="md-input"
          value={name}
          placeholder="NAME"
          aria-label="Secret name"
          aria-invalid={Boolean(name.trim()) && !NAME_RE.test(name.trim())}
          autoComplete="off"
          spellCheck={false}
          onChange={(event) => setName(event.target.value)}
        />
        <input
          className="md-input"
          value={value}
          type="password"
          placeholder="Value"
          aria-label="Secret value"
          autoComplete="new-password"
          onChange={(event) => setValue(event.target.value)}
        />
        <button className="md-btn md-btn--primary" type="submit" disabled={(!name.trim() || !value) && !saved}>
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
