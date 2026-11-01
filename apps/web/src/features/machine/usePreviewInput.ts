"use client";

import { useCallback, useRef, useState } from "react";
import type { ClipboardEvent, KeyboardEvent, MouseEvent, WheelEvent } from "react";
import { api } from "@/lib/api";

export type Viewport = { width: number; height: number };

type Options = {
  enabled: boolean;
  viewport: Viewport;
  onFrame: (dataUrl: string, url: string | null) => void;
  onError: (message: string) => void;
};

/** Named keys the board will press — mirrors the runtime's allow-list. */
const PRESSABLE = new Set([
  "Enter",
  "Backspace",
  "Tab",
  "Escape",
  "Delete",
  "Home",
  "End",
  "PageUp",
  "PageDown",
  "ArrowUp",
  "ArrowDown",
  "ArrowLeft",
  "ArrowRight",
]);

/** Typed characters are batched so one flush becomes one relay round-trip. */
const FLUSH_MS = 700;

/**
 * Drives the board's warm Chromium from a preview frame.
 *
 * Every gesture is one `interact` action and comes back as a fresh JPEG, so the
 * frame stays a static `<img>` while still behaving like a live app: clicks map
 * to viewport fractions, the wheel scrolls, keys and pasted text get typed.
 */
export function usePreviewInput({ enabled, viewport, onFrame, onError }: Options) {
  const [sending, setSending] = useState(false);
  const inflight = useRef(false);
  const buffer = useRef("");
  const timer = useRef<number | null>(null);

  const send = useCallback(
    async (input: string, extra: Record<string, number | string> = {}) => {
      if (!enabled || inflight.current) return;
      inflight.current = true;
      setSending(true);
      try {
        const res = await api.browserAction({
          action: "interact",
          input,
          width: viewport.width,
          height: viewport.height,
          ...extra,
        });
        if (res.image_b64) {
          onFrame(`data:${res.image_mime ?? "image/jpeg"};base64,${res.image_b64}`, res.url ?? null);
        }
        if (res.ok === false) onError(res.error ?? "The board could not apply that input.");
      } catch (err) {
        onError(err instanceof Error ? err.message : "The board did not answer.");
      } finally {
        inflight.current = false;
        setSending(false);
      }
    },
    [enabled, viewport, onFrame, onError],
  );

  const flushText = useCallback(() => {
    if (timer.current) {
      window.clearTimeout(timer.current);
      timer.current = null;
    }
    const text = buffer.current;
    buffer.current = "";
    if (text) void send("text", { text });
  }, [send]);

  const onClick = useCallback(
    (event: MouseEvent<HTMLImageElement>) => {
      if (!enabled) return;
      const rect = event.currentTarget.getBoundingClientRect();
      if (!rect.width || !rect.height) return;
      void send("click", {
        x: (event.clientX - rect.left) / rect.width,
        y: (event.clientY - rect.top) / rect.height,
      });
    },
    [enabled, send],
  );

  const onWheel = useCallback(
    (event: WheelEvent<HTMLImageElement>) => {
      if (!enabled) return;
      const dy = Math.max(-1200, Math.min(1200, event.deltaY));
      if (Math.abs(dy) < 4) return;
      void send("scroll", { dy });
    },
    [enabled, send],
  );

  const onKeyDown = useCallback(
    (event: KeyboardEvent<HTMLDivElement>) => {
      if (!enabled) return;
      if (PRESSABLE.has(event.key)) {
        event.preventDefault();
        flushText();
        void send("key", { key: event.key });
        return;
      }
      if (event.key.length === 1 && !event.metaKey && !event.ctrlKey && !event.altKey) {
        event.preventDefault();
        buffer.current = (buffer.current + event.key).slice(-500);
        if (timer.current) window.clearTimeout(timer.current);
        timer.current = window.setTimeout(flushText, FLUSH_MS);
      }
    },
    [enabled, flushText, send],
  );

  const onPaste = useCallback(
    (event: ClipboardEvent<HTMLDivElement>) => {
      if (!enabled) return;
      const text = event.clipboardData.getData("text");
      if (!text) return;
      event.preventDefault();
      void send("text", { text });
    },
    [enabled, send],
  );

  return { sending, onClick, onWheel, onKeyDown, onPaste };
}
