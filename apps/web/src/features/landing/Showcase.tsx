"use client";

import { useState } from "react";
import { Icon } from "@/ui/Icon";

type Line = { kind: "user" | "tool" | "out" | "note"; text: string };

const ITEMS: Array<{ id: string; title: string; body: string; lines: Line[] }> = [
  {
    id: "route",
    title: "Board-first routing",
    body: "Every turn gets a tier before it costs anything. Short work is processed locally on the board; only the turns that need more climb to the cloud.",
    lines: [
      { kind: "user", text: "summarise the last deploy log" },
      { kind: "note", text: "tier  local · on-board model · 0.7s · $0.00" },
      { kind: "user", text: "refactor the relay reconnect logic across the agent" },
      { kind: "note", text: "tier  heavy · muse-wonder-1.0 · budget 62% left" },
    ],
  },
  {
    id: "tools",
    title: "Tools kept on a leash",
    body: "The model asks for a listing, a read or a shell command in a tagged block. Each one runs inside the desk root and nothing outside it. Patches and deploys wait for your approval.",
    lines: [
      { kind: "user", text: "list the workspace" },
      { kind: "tool", text: "$ ls -la ~/desk" },
      { kind: "out", text: "apps/  docs/  logs/  README.md" },
      { kind: "note", text: "patch · awaiting your approval" },
    ],
  },
  {
    id: "missions",
    title: "Missions in parallel",
    body: "Fork one prompt into several independent threads. They run side by side on the board, persist in the job history, and each one can be stopped or removed on its own.",
    lines: [
      { kind: "user", text: "Fork x3" },
      { kind: "out", text: "thread 1 · audit api routes     running" },
      { kind: "out", text: "thread 2 · check d1 migrations  running" },
      { kind: "out", text: "thread 3 · review relay logs    done" },
    ],
  },
  {
    id: "keys",
    title: "No key in the browser",
    body: "The board token lives in an httpOnly cookie and the BFF is the only thing that talks upstream. The Meta key never leaves the Worker; the board holds only a device token.",
    lines: [
      { kind: "note", text: "browser   no credential held" },
      { kind: "note", text: "bff       bearer from httpOnly cookie" },
      { kind: "note", text: "worker    META_API_KEY · metered in D1" },
      { kind: "note", text: "board     device_token only" },
    ],
  },
  {
    id: "fleet",
    title: "A fleet, not one box",
    body: "Pair several boards to one account and switch between them from the same desk. Chat, files and telemetry follow the board you pick.",
    lines: [
      { kind: "out", text: "kratos    online   41°C" },
      { kind: "out", text: "workshop  online   38°C" },
      { kind: "out", text: "emu-01    offline" },
      { kind: "note", text: "active board · kratos" },
    ],
  },
];

/** Left: a miniature of the desk. Right: an accordion that drives it. */
export function Showcase() {
  const [open, setOpen] = useState(ITEMS[0].id);
  const current = ITEMS.find((item) => item.id === open) ?? ITEMS[0];

  return (
    <div className="ml-show">
      <div className="ml-show__stage" aria-live="polite">
        <div className="ml-show__chrome">
          <span />
          <span />
          <span />
          <em>{current.title}</em>
        </div>
        <div className="ml-show__screen">
          {current.lines.map((line, index) => (
            <p key={`${current.id}-${index}`} className={`ml-line ml-line--${line.kind}`}>
              {line.text}
            </p>
          ))}
        </div>
      </div>

      <ul className="ml-acc">
        {ITEMS.map((item) => {
          const on = item.id === open;
          return (
            <li key={item.id} className={`ml-acc__item ${on ? "ml-acc__item--on" : ""}`}>
              <button
                type="button"
                className="ml-acc__head"
                aria-expanded={on}
                onClick={() => setOpen(item.id)}
              >
                <span>{item.title}</span>
                <Icon name={on ? "minus" : "plus"} size={22} />
              </button>
              {on ? <p className="ml-acc__body">{item.body}</p> : null}
            </li>
          );
        })}
      </ul>
    </div>
  );
}
