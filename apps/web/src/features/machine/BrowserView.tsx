"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { api } from "@/lib/api";
import type { BrowserArtifact, BrowserStatus } from "@/shared/types";
import { usePreviewInput, type Viewport } from "./usePreviewInput";

type Orientation = "landscape" | "portrait";

const VIEWPORTS: Record<Orientation, Viewport> = {
  landscape: { width: 960, height: 540 },
  portrait: { width: 390, height: 844 },
};

const IMAGE_KINDS = new Set(["png", "jpg", "jpeg"]);

function humanSize(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
}

function isImage(artifact: BrowserArtifact): boolean {
  return IMAGE_KINDS.has(artifact.kind);
}

/** `example.com` → `https://example.com`; local addresses default to plain http. */
function withScheme(raw: string): string {
  const url = raw.trim();
  if (!url || /^[a-z][a-z0-9+.-]*:/i.test(url)) return url;
  const local = /^(localhost|127\.|10\.|192\.168\.|\[?::1\]?)/i.test(url);
  return `${local ? "http" : "https"}://${url}`;
}

/**
 * Preview: the board's own Chromium.
 *
 * The desk drives a real browser on the board — it opens pages, clicks, types,
 * and files every screenshot under the desk root. The frame here is a static
 * `<img>` (one relay round-trip per gesture), which stays usable even though it
 * is not an iframe.
 */
export function BrowserView() {
  const [status, setStatus] = useState<BrowserStatus | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [target, setTarget] = useState("");
  const [liveUrl, setLiveUrl] = useState<string | null>(null);
  const [frame, setFrame] = useState<string | null>(null);
  const [selected, setSelected] = useState<string | null>(null);
  const [snapshot, setSnapshot] = useState<{ title: string; text: string } | null>(null);
  const [orientation, setOrientation] = useState<Orientation>("landscape");
  const [interactive, setInteractive] = useState(false);
  const generation = useRef(0);
  const snapshotRef = useRef<HTMLDivElement | null>(null);
  const stageRef = useRef<HTMLDivElement | null>(null);
  // The status poll reads this, so it never swaps a live frame for a saved one.
  const frameRef = useRef<string | null>(null);
  frameRef.current = frame;
  const viewport = VIEWPORTS[orientation];

  // The snapshot renders below a tall frame; bring it into view when it lands.
  useEffect(() => {
    if (snapshot) snapshotRef.current?.scrollIntoView({ behavior: "smooth", block: "nearest" });
  }, [snapshot]);

  const showFrame = useCallback((src: string, url: string | null) => {
    setFrame(src);
    setSelected(null);
    setSnapshot(null);
    if (url) {
      setLiveUrl(url);
      setTarget((prev) => prev || url);
    }
    setError(null);
  }, []);

  const input = usePreviewInput({
    enabled: interactive && Boolean(frame) && !busy,
    viewport,
    onFrame: showFrame,
    onError: setError,
  });

  const refresh = useCallback(async () => {
    try {
      const next = await api.browserStatus();
      setStatus(next);
      setError(null);
      if (next.url) setLiveUrl(next.url);
      // With no page open, show the last capture. With one open, a fresh frame is
      // taken on arrival instead (below): an old still could show a page as it
      // was before a fix. Never replace a live frame with a capture either.
      if (next.last_shot && !next.url && !frameRef.current) setSelected((prev) => prev ?? next.last_shot);
    } catch (err) {
      setError(err instanceof Error ? err.message : "The board browser is unavailable.");
    }
  }, []);

  useEffect(() => {
    void refresh();
    const timer = window.setInterval(() => void refresh(), 6_000);
    return () => window.clearInterval(timer);
  }, [refresh]);

  const capture = useCallback(
    async (url: string, size: Viewport) => {
      const mine = ++generation.current;
      setBusy(true);
      setError(null);
      try {
        // Warm in parallel so Chromium is up before, or with, the capture.
        void api.browserWarm().catch(() => undefined);
        const res = await api.browserAction({ action: "preview", url, ...size });
        if (mine !== generation.current) return;
        if (res.image_b64) {
          showFrame(`data:${res.image_mime ?? "image/jpeg"};base64,${res.image_b64}`, res.url ?? url);
        } else if (res.shot) {
          setSelected(res.shot);
        }
        if (res.ok === false) setError(res.error ?? "The preview could not be captured.");
      } catch (err) {
        if (mine !== generation.current) return;
        const message = err instanceof Error ? err.message : "The preview could not be captured.";
        setError(
          /timeout|504|timed out/i.test(message)
            ? "The preview timed out. Try Refresh — Chromium may still be warming."
            : message,
        );
      } finally {
        if (mine === generation.current) setBusy(false);
      }
    },
    [showFrame],
  );

  const run = useCallback(
    async (action: string) => {
      setBusy(true);
      setError(null);
      try {
        const res = await api.browserAction({ action });
        // A snapshot's result is its text, so the live frame stays on stage.
        if (res.shot && action !== "snapshot") setSelected(res.shot);
        if (action === "snapshot" && res.ok) {
          setSnapshot({ title: res.title ?? "", text: res.text ?? "" });
        }
        if (res.ok === false) setError(res.error ?? "The board could not run that action.");
      } catch (err) {
        setError(err instanceof Error ? err.message : "The board did not answer.");
      } finally {
        setBusy(false);
      }
    },
    [],
  );

  // Coming back to Preview with a page still open on the board: shoot it fresh
  // once, so the stage shows the page as it is now.
  const primed = useRef(false);
  useEffect(() => {
    if (primed.current || !liveUrl || frame) return;
    primed.current = true;
    void capture(liveUrl, viewport);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [liveUrl]);

  const open = useCallback(() => {
    const url = withScheme(target);
    if (!url) return;
    setTarget(url);
    setInteractive(true);
    void capture(url, viewport);
  }, [capture, target, viewport]);

  const close = useCallback(async () => {
    setBusy(true);
    try {
      await api.browserClose();
      setFrame(null);
      setLiveUrl(null);
      setSelected(null);
      setStatus(await api.browserStatus());
    } catch (err) {
      setError(err instanceof Error ? err.message : "The browser could not be closed.");
    } finally {
      setBusy(false);
    }
  }, []);

  // A different orientation resizes the board's viewport, so the frame is re-shot.
  useEffect(() => {
    if (!interactive || !liveUrl) return;
    void capture(liveUrl, viewport);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [orientation]);

  // React wheel listeners are passive, so a live frame needs a native one to keep
  // the page from scrolling along with the board.
  const liveInput = interactive && Boolean(frame) && !selected;
  useEffect(() => {
    const stage = stageRef.current;
    if (!stage || !liveInput) return;
    const hold = (event: WheelEvent) => event.preventDefault();
    stage.addEventListener("wheel", hold, { passive: false });
    return () => stage.removeEventListener("wheel", hold);
  }, [liveInput]);

  const artifacts = status?.artifacts ?? [];
  const ready = status?.playwright ?? false;
  // Until the first status arrives, assume the browser works rather than flash a disabled bar.
  const usable = status === null || ready;
  const stageSrc = selected ? api.browserArtifactUrl(selected) : frame;

  return (
    <div className="md-preview">
      <p className="md-muted md-preview__note">
        The board runs its own Chromium. Open any URL to see it here; with Live on, your clicks,
        scrolls and typing are replayed on the board and come back as fresh frames.
      </p>

      {status && !ready ? (
        <p className="md-error" role="alert">
          {status.detail}
        </p>
      ) : null}
      {error ? (
        <p className="md-error" role="alert">
          {error}
        </p>
      ) : null}

      <section className="md-card md-preview__toolbar">
        <div className="md-preview__bar">
          <input
            className="md-input md-preview__url"
            type="url"
            inputMode="url"
            placeholder="http://127.0.0.1:5173"
            aria-label="Page address"
            value={target}
            disabled={!usable}
            onChange={(event) => setTarget(event.target.value)}
            onKeyDown={(event) => {
              if (event.key === "Enter") open();
            }}
          />
          <button type="button" className="md-btn" disabled={busy || !usable || !target.trim()} onClick={open}>
            {busy ? "Capturing…" : "Open"}
          </button>
          <button
            type="button"
            className="md-btn md-btn--ghost"
            disabled={busy || !liveUrl}
            onClick={() => liveUrl && void capture(liveUrl, viewport)}
          >
            Refresh
          </button>
          <button type="button" className="md-btn md-btn--ghost" disabled={busy || !liveUrl} onClick={() => void run("screenshot")}>
            Screenshot
          </button>
          <button type="button" className="md-btn md-btn--ghost" disabled={busy || !liveUrl} onClick={() => void run("snapshot")}>
            Snapshot
          </button>
          <button type="button" className="md-btn md-btn--ghost" disabled={busy || !liveUrl} onClick={() => void close()}>
            Close
          </button>
        </div>

        <div className="md-preview__controls">
          <div className="md-tabs" role="group" aria-label="Preview size">
            <button
              type="button"
              aria-pressed={orientation === "landscape"}
              className={`md-tab ${orientation === "landscape" ? "md-tab--on" : ""}`}
              onClick={() => setOrientation("landscape")}
            >
              Desktop
            </button>
            <button
              type="button"
              aria-pressed={orientation === "portrait"}
              className={`md-tab ${orientation === "portrait" ? "md-tab--on" : ""}`}
              onClick={() => setOrientation("portrait")}
            >
              Mobile
            </button>
          </div>
          <label className="md-preview__toggle">
            <input
              type="checkbox"
              checked={interactive}
              onChange={(event) => setInteractive(event.target.checked)}
            />
            Live
          </label>
          <span className="md-preview__urlbar">{liveUrl ?? "No page open"}</span>
        </div>
        {selected && interactive && liveUrl ? (
          <p className="md-note">
            Showing a saved frame, so Live input is paused.{" "}
            <button type="button" className="md-linkbtn" onClick={() => void capture(liveUrl, viewport)}>
              Back to the live page
            </button>
          </p>
        ) : null}
      </section>

      <section className="md-card md-preview__stagewrap">
        <div
          ref={stageRef}
          className={`md-preview__stage ${orientation === "portrait" ? "md-preview__stage--portrait" : ""}`}
          data-interactive={liveInput}
          data-sending={input.sending}
          tabIndex={liveInput ? 0 : undefined}
          aria-label={liveInput ? "Live page: click, scroll or type to drive it" : undefined}
          onKeyDown={input.onKeyDown}
          onPaste={input.onPaste}
        >
          {stageSrc ? (
            <img
              className="md-preview__shot"
              src={stageSrc}
              alt="Board browser frame"
              draggable={false}
              onClick={selected ? undefined : input.onClick}
              onWheel={selected ? undefined : input.onWheel}
            />
          ) : (
            <p className="md-muted md-preview__empty">
              {busy ? "Capturing on the board…" : "No page open. Enter a URL and press Open."}
            </p>
          )}
        </div>
      </section>

      {snapshot ? (
        <div className="md-card md-preview__snapshot" ref={snapshotRef}>
          <p className="md-crumb">{snapshot.title || "Snapshot"}</p>
          <pre className="md-code">{snapshot.text || "(empty page)"}</pre>
        </div>
      ) : null}

      {artifacts.length ? (
        <section className="md-preview__files" aria-label="Captured frames">
          <h3 className="md-jobs__title">Captured frames</h3>
          <ul className="md-preview__list">
            {artifacts.map((artifact) => (
              <li key={artifact.path}>
                <button
                  type="button"
                  className={`md-preview__item ${selected === artifact.path ? "md-preview__item--on" : ""}`}
                  onClick={() => {
                    if (!isImage(artifact)) {
                      window.open(api.browserArtifactUrl(artifact.path), "_blank", "noopener");
                      return;
                    }
                    setSelected(artifact.path);
                    setSnapshot(null);
                  }}
                >
                  <span className="md-preview__itemname">{artifact.name}</span>
                  <span className="md-file__size">{humanSize(artifact.bytes)}</span>
                </button>
              </li>
            ))}
          </ul>
        </section>
      ) : null}
    </div>
  );
}
