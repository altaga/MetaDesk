"use client";

import { useEffect, useRef, type KeyboardEvent } from "react";

/**
 * A row of tabs that behaves like one: arrow keys, Home and End move between
 * them, only the selected tab is in the Tab order, and the selected tab is
 * scrolled into view when the row is wider than the screen.
 */
export function TabList<T extends string>({
  tabs,
  value,
  onChange,
  label,
}: {
  tabs: ReadonlyArray<{ id: T; label: string }>;
  value: T;
  onChange: (id: T) => void;
  label: string;
}) {
  const rowRef = useRef<HTMLDivElement | null>(null);

  useEffect(() => {
    rowRef.current
      ?.querySelector<HTMLElement>('[aria-selected="true"]')
      ?.scrollIntoView({ block: "nearest", inline: "nearest" });
  }, [value]);

  function onKeyDown(event: KeyboardEvent<HTMLDivElement>) {
    const index = tabs.findIndex((tab) => tab.id === value);
    const moves: Record<string, number> = {
      ArrowRight: index + 1,
      ArrowLeft: index - 1,
      Home: 0,
      End: tabs.length - 1,
    };
    if (!(event.key in moves)) return;
    event.preventDefault();
    const next = tabs[(moves[event.key] + tabs.length) % tabs.length];
    onChange(next.id);
    window.requestAnimationFrame(() =>
      rowRef.current?.querySelector<HTMLElement>(`[data-tab="${next.id}"]`)?.focus(),
    );
  }

  return (
    <div className="md-tabs" role="tablist" aria-label={label} ref={rowRef} onKeyDown={onKeyDown}>
      {tabs.map((tab) => (
        <button
          key={tab.id}
          type="button"
          role="tab"
          data-tab={tab.id}
          aria-selected={value === tab.id}
          tabIndex={value === tab.id ? 0 : -1}
          className={`md-tab ${value === tab.id ? "md-tab--on" : ""}`}
          onClick={() => onChange(tab.id)}
        >
          {tab.label}
        </button>
      ))}
    </div>
  );
}
