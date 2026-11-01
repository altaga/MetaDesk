"use client";

import Link from "next/link";
import { useState } from "react";
import { loginAction } from "@/app/actions/auth";
import { BrandMark } from "@/ui/BrandMark";

export function LoginScreen() {
  const [username, setUsername] = useState("");
  const [password, setPassword] = useState("");
  const [pending, setPending] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function onSubmit(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (pending) return;
    setPending(true);
    setError(null);
    const result = await loginAction(username.trim(), password);
    if (result.ok) {
      // Full reload so the desk boots with the fresh session cookie.
      window.location.assign("/dashboard");
      return;
    }
    setError(result.error);
    setPending(false);
  }

  return (
    <main className="md-auth">
      <section className="md-card md-auth__card">
        <BrandMark />
        <h1 className="md-auth__title">Sign in to the desk</h1>
        <p className="md-auth__sub">
          Use the operator credentials your board was bootstrapped with.
        </p>

        <form className="md-auth__form" onSubmit={onSubmit}>
          <label className="md-field">
            <span className="md-label">Operator</span>
            <input
              className="md-input"
              name="username"
              autoComplete="username"
              value={username}
              onChange={(event) => setUsername(event.target.value)}
              required
            />
          </label>

          <label className="md-field">
            <span className="md-label">Password</span>
            <input
              className="md-input"
              name="password"
              type="password"
              autoComplete="current-password"
              value={password}
              onChange={(event) => setPassword(event.target.value)}
              required
            />
          </label>

          {error ? (
            <p className="md-error" role="alert">
              {error}
            </p>
          ) : null}

          <button className="md-btn md-btn--primary" type="submit" disabled={pending}>
            {pending ? "Signing in…" : "Sign in"}
          </button>
        </form>

        <p className="md-auth__sub" style={{ marginTop: "20px", marginBottom: 0 }}>
          <Link href="/">← Back to the overview</Link>
        </p>
      </section>
    </main>
  );
}
