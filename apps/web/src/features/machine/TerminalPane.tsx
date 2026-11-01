"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import type { FitAddon } from "@xterm/addon-fit";
import type { Terminal } from "@xterm/xterm";
import { api } from "@/lib/api";
import "@xterm/xterm/css/xterm.css";

type Phase = "idle" | "connecting" | "live" | "closed" | "error";

const LABEL: Record<Phase, string> = {
  idle: "Not connected",
  connecting: "Connecting",
  live: "Live",
  closed: "Disconnected",
  error: "Failed",
};

/** A dark palette that reads well on the desk surface. */
const THEME = {
  background: "#04060e",
  foreground: "#e9eefc",
  cursor: "#7a5cff",
  selectionBackground: "rgba(122, 92, 255, 0.35)",
  black: "#0a0f1e",
  brightBlack: "#8e9ac0",
};

type Frame = { type: "input"; data: string } | { type: "resize"; cols: number; rows: number };

type TerminalPaneProps = {
  /** The board the operator is driving; null means there is nothing to reach. */
  deviceId: string | null;
  /** Emulated boards have no shell, so the terminal stays shut. */
  disabled?: boolean;
};

/**
 * Terminal: a real login shell on the board.
 *
 * The browser never dials the board directly. It asks the cloud for a
 * single-use ticket, opens the relay's terminal socket with it, and from then
 * on the relay bridges keystrokes to a pty the board agent owns. xterm lives
 * here purely as the emulator; every byte travels over the relay.
 */
export function TerminalPane({ deviceId, disabled = false }: TerminalPaneProps) {
  const hostRef = useRef<HTMLDivElement | null>(null);
  const termRef = useRef<Terminal | null>(null);
  const fitRef = useRef<FitAddon | null>(null);
  const socketRef = useRef<WebSocket | null>(null);
  // Bumped on every teardown so an in-flight connect can tell it was superseded.
  const runRef = useRef(0);
  const [phase, setPhase] = useState<Phase>("idle");
  const [error, setError] = useState<string | null>(null);

  /** Drop the emulator and the socket without invalidating a running connect. */
  const dispose = useCallback(() => {
    const socket = socketRef.current;
    socketRef.current = null;
    if (socket) {
      socket.onopen = null;
      socket.onmessage = null;
      socket.onclose = null;
      socket.onerror = null;
      socket.close();
    }
    termRef.current?.dispose();
    termRef.current = null;
    fitRef.current = null;
  }, []);

  /** Invalidate any pending connect, then drop everything live. */
  const teardown = useCallback(() => {
    runRef.current += 1;
    dispose();
  }, [dispose]);

  const connect = useCallback(async () => {
    const host = hostRef.current;
    if (!host || !deviceId || disabled) return;
    const run = ++runRef.current;
    const current = () => run === runRef.current;
    setPhase("connecting");
    setError(null);
    try {
      const [{ Terminal: Emulator }, { FitAddon: Fitter }] = await Promise.all([
        import("@xterm/xterm"),
        import("@xterm/addon-fit"),
      ]);
      if (!current()) return;
      // A reconnect builds a fresh emulator so no scrollback from the last
      // shell bleeds into the new one.
      dispose();

      const term = new Emulator({
        cursorBlink: true,
        fontFamily: 'ui-monospace, SFMono-Regular, Menlo, Consolas, "Liberation Mono", monospace',
        fontSize: 13,
        scrollback: 5000,
        theme: THEME,
      });
      const fit = new Fitter();
      term.loadAddon(fit);
      term.open(host);
      fit.fit();
      termRef.current = term;
      fitRef.current = fit;

      const ticket = await api.terminalTicket(deviceId);
      if (!current()) {
        term.dispose();
        return;
      }
      const socket = new WebSocket(ticket.ws_url);
      socket.binaryType = "arraybuffer";
      socketRef.current = socket;

      const send = (frame: Frame) => {
        if (socket.readyState === WebSocket.OPEN) socket.send(JSON.stringify(frame));
      };
      term.onData((data) => send({ type: "input", data }));
      term.onResize(({ cols, rows }) => send({ type: "resize", cols, rows }));

      socket.onopen = () => {
        if (!current()) return;
        setPhase("live");
        fit.fit();
        // The pty opens at the relay's default size and onResize only fires on
        // a change, so tell the board the real size once the link is up.
        send({ type: "resize", cols: term.cols, rows: term.rows });
        term.focus();
      };
      socket.onmessage = (event) => {
        if (!current()) return;
        const data: unknown = event.data;
        if (typeof data === "string") term.write(data);
        else if (data instanceof ArrayBuffer) term.write(new Uint8Array(data));
      };
      socket.onerror = () => {
        if (!current()) return;
        setError("The terminal link dropped.");
        setPhase("error");
      };
      socket.onclose = () => {
        if (current()) setPhase((prev) => (prev === "error" ? prev : "closed"));
      };
    } catch (err) {
      if (!current()) return;
      setError(err instanceof Error ? err.message : "Could not open a terminal.");
      setPhase("error");
    }
  }, [deviceId, disabled, dispose]);

  // Keep the emulator fitted to its container as the layout moves.
  useEffect(() => {
    const host = hostRef.current;
    if (!host || typeof ResizeObserver === "undefined") return;
    const observer = new ResizeObserver(() => fitRef.current?.fit());
    observer.observe(host);
    return () => observer.disconnect();
  }, []);

  // A new board (or an unmount) closes the shell; a live board opens one.
  useEffect(() => {
    if (!deviceId || disabled) {
      teardown();
      setPhase("idle");
      return;
    }
    void connect();
    return () => teardown();
  }, [deviceId, disabled, connect, teardown]);

  if (disabled || !deviceId) {
    return (
      <div className="md-term">
        <p className="md-term__empty md-muted">
          {disabled
            ? "This board is emulated, so it has no shell to open."
            : "Pair a board to open a shell on it."}
        </p>
      </div>
    );
  }

  return (
    <div className="md-term">
      <section className="md-card md-term__panel">
        <div className="md-term__bar">
          <span className={`md-term__status md-term__status--${phase}`}>
            {LABEL[phase]}
            {phase === "connecting" ? "…" : ""}
          </span>
          <div className="md-term__actions">
            <button
              type="button"
              className="md-btn md-btn--sm md-btn--ghost"
              onClick={() => void connect()}
              disabled={phase === "connecting"}
            >
              {phase === "live" || phase === "connecting" ? "Reconnect" : "Connect"}
            </button>
            <button
              type="button"
              className="md-btn md-btn--sm md-btn--ghost"
              onClick={() => {
                teardown();
                setPhase("closed");
              }}
              disabled={phase !== "live" && phase !== "connecting"}
            >
              Disconnect
            </button>
          </div>
        </div>
        <p className="md-note">
          A live shell on the board. Reconnect starts a fresh terminal session; leaving this tab closes it.
        </p>
        {error ? (
          <p className="md-error" role="alert">
            {error}
          </p>
        ) : null}
        <div className="md-term__stage" ref={hostRef} />
      </section>
    </div>
  );
}
