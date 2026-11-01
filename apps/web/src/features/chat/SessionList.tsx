"use client";

import { useEffect, useMemo, useRef, useState, type DragEvent, type KeyboardEvent } from "react";
import type { Session } from "@/shared/types";
import { Icon } from "@/ui/Icon";

type SortKey = "custom" | "recent" | "name" | "oldest";

const SORTS: Array<{ key: SortKey; label: string }> = [
  { key: "custom", label: "Custom order" },
  { key: "recent", label: "Recent activity" },
  { key: "name", label: "Name A–Z" },
  { key: "oldest", label: "Oldest first" },
];

/** The operator's sort choice is a per-browser convenience; it never leaves the device. */
const SORT_KEY = "metadesk.sessionSort";

export function sessionTitle(title: string): string {
  const clean = title.trim();
  return clean || "Untitled session";
}

function sessionStamp(raw?: string | null): string {
  if (!raw) return "";
  const at = new Date(raw);
  if (Number.isNaN(at.getTime())) return "";
  const delta = Date.now() - at.getTime();
  if (delta < 60_000) return "just now";
  if (delta < 3_600_000) return `${Math.max(1, Math.round(delta / 60_000))}m ago`;
  if (delta < 86_400_000) return `${Math.max(1, Math.round(delta / 3_600_000))}h ago`;
  return at.toLocaleDateString(undefined, { month: "short", day: "numeric" });
}

function sessionMeta(session: Session): string {
  const stamp = sessionStamp(session.updated_at ?? session.created_at);
  const count = session.message_count;
  if (count === undefined) return stamp;
  const size = count === 0 ? "empty" : `${count} message${count === 1 ? "" : "s"}`;
  return stamp ? `${stamp} · ${size}` : size;
}

function activity(session: Session): number {
  return new Date(session.updated_at ?? session.created_at).getTime() || 0;
}

function sortSessions(list: Session[], sort: SortKey): Session[] {
  const out = [...list];
  if (sort === "custom") out.sort((a, b) => (a.position ?? -a.id) - (b.position ?? -b.id) || b.id - a.id);
  if (sort === "recent") out.sort((a, b) => activity(b) - activity(a) || b.id - a.id);
  if (sort === "name") out.sort((a, b) => sessionTitle(a.title).localeCompare(sessionTitle(b.title)) || b.id - a.id);
  if (sort === "oldest") out.sort((a, b) => a.id - b.id);
  return out;
}

function readSort(): SortKey {
  try {
    const saved = window.localStorage.getItem(SORT_KEY);
    return SORTS.some((item) => item.key === saved) ? (saved as SortKey) : "custom";
  } catch {
    return "custom";
  }
}

/**
 * Inline title editor. Enter or leaving the field saves, Escape cancels, and an
 * empty or unchanged title is simply dropped.
 */
export function TitleEditor({
  initial,
  className,
  onSave,
  onDone,
}: {
  initial: string;
  className: string;
  onSave: (title: string) => void;
  onDone: () => void;
}) {
  const [value, setValue] = useState(initial);
  const settled = useRef(false);

  function finish(save: boolean) {
    if (settled.current) return;
    settled.current = true;
    const clean = value.trim();
    if (save && clean && clean !== initial) onSave(clean);
    onDone();
  }

  return (
    <input
      className={className}
      value={value}
      maxLength={120}
      aria-label="Session name"
      autoFocus
      onFocus={(event) => event.currentTarget.select()}
      onChange={(event) => setValue(event.target.value)}
      onBlur={() => finish(true)}
      onKeyDown={(event) => {
        if (event.key === "Enter") {
          event.preventDefault();
          finish(true);
        }
        if (event.key === "Escape") {
          event.preventDefault();
          finish(false);
        }
      }}
    />
  );
}

type Drop = { id: number; after: boolean };

/**
 * The session rail: search, sort, pin, rename, delete and, in custom order,
 * drag (or arrow keys on the grip) to rearrange. Pinned sessions stay on top
 * in every sort, and a drag only moves a session within its own group.
 */
export function SessionList({
  sessions,
  activeId,
  onOpen,
  onNew,
  onRename,
  onPin,
  onDelete,
  onReorder,
  onClearEmpty,
}: {
  sessions: Session[];
  activeId: number | null;
  onOpen: (id: number) => void;
  onNew: () => void;
  onRename: (id: number, title: string) => void;
  onPin: (id: number, pinned: boolean) => void;
  onDelete: (id: number) => void;
  onReorder: (ids: number[]) => void;
  onClearEmpty: () => void;
}) {
  const [sort, setSort] = useState<SortKey>("custom");
  const [query, setQuery] = useState("");
  const [confirmId, setConfirmId] = useState<number | null>(null);
  const [editingId, setEditingId] = useState<number | null>(null);
  const [dragId, setDragId] = useState<number | null>(null);
  const [drop, setDrop] = useState<Drop | null>(null);
  const [announce, setAnnounce] = useState("");
  const listRef = useRef<HTMLDivElement | null>(null);

  useEffect(() => setSort(readSort()), []);

  function chooseSort(next: SortKey) {
    setSort(next);
    try {
      window.localStorage.setItem(SORT_KEY, next);
    } catch {
      /* private window or blocked storage: the choice just won't stick */
    }
  }

  const needle = query.trim().toLowerCase();
  const { pinned, rest } = useMemo(() => {
    const shown = needle ? sessions.filter((item) => item.title.toLowerCase().includes(needle)) : sessions;
    const sorted = sortSessions(shown, sort);
    return { pinned: sorted.filter((item) => item.pinned), rest: sorted.filter((item) => !item.pinned) };
  }, [sessions, sort, needle]);

  const canArrange = sort === "custom" && !needle;
  const emptyCount = sessions.filter((item) => item.message_count === 0 && !item.pinned && item.id !== activeId).length;

  /** Move one session to `index` inside its group and save the whole order. */
  function moveTo(id: number, index: number) {
    const group = pinned.some((item) => item.id === id) ? pinned : rest;
    const ids = group.map((item) => item.id).filter((other) => other !== id);
    const clamped = Math.max(0, Math.min(index, ids.length));
    if (group[clamped]?.id === id) return; // already there
    ids.splice(clamped, 0, id);
    const order = group === pinned ? [...ids, ...rest.map((item) => item.id)] : [...pinned.map((item) => item.id), ...ids];
    onReorder(order);
    const moved = sessions.find((item) => item.id === id);
    setAnnounce(`${sessionTitle(moved?.title ?? "")} moved to position ${clamped + 1} of ${group.length}.`);
  }

  function onGripKey(event: KeyboardEvent<HTMLButtonElement>, id: number, index: number) {
    if (event.key !== "ArrowUp" && event.key !== "ArrowDown") return;
    event.preventDefault();
    moveTo(id, index + (event.key === "ArrowUp" ? -1 : 1));
    // Keep focus on the grip of the row that moved.
    window.requestAnimationFrame(() =>
      listRef.current?.querySelector<HTMLButtonElement>(`[data-grip="${id}"]`)?.focus(),
    );
  }

  function onDragOver(event: DragEvent<HTMLDivElement>, target: Session) {
    if (dragId === null || dragId === target.id) return;
    const source = sessions.find((item) => item.id === dragId);
    if (!source || Boolean(source.pinned) !== Boolean(target.pinned)) return;
    event.preventDefault();
    event.dataTransfer.dropEffect = "move";
    const box = event.currentTarget.getBoundingClientRect();
    const after = event.clientY > box.top + box.height / 2;
    if (drop?.id !== target.id || drop.after !== after) setDrop({ id: target.id, after });
  }

  function onDropRow(event: DragEvent<HTMLDivElement>, group: Session[]) {
    event.preventDefault();
    if (dragId !== null && drop) {
      const ids = group.map((item) => item.id).filter((id) => id !== dragId);
      const at = ids.indexOf(drop.id);
      if (at !== -1) moveTo(dragId, at + (drop.after ? 1 : 0));
    }
    setDragId(null);
    setDrop(null);
  }

  function row(session: Session, index: number, group: Session[]) {
    const title = sessionTitle(session.title);
    if (confirmId === session.id) {
      // Deleting a chat cannot be undone, so the row asks first.
      return (
        <div
          key={session.id}
          className="md-session md-session--confirm"
          role="alertdialog"
          aria-label={`Delete ${title}?`}
          onKeyDown={(event) => {
            if (event.key === "Escape") setConfirmId(null);
          }}
        >
          <span className="md-session__ask">
            Delete <strong>{title}</strong>? This cannot be undone.
          </span>
          <span className="md-session__actions">
            <button type="button" className="md-btn md-btn--sm md-btn--ghost" autoFocus onClick={() => setConfirmId(null)}>
              Cancel
            </button>
            <button
              type="button"
              className="md-btn md-btn--sm md-btn--danger"
              onClick={() => {
                setConfirmId(null);
                onDelete(session.id);
              }}
            >
              Delete
            </button>
          </span>
        </div>
      );
    }

    const classes = [
      "md-session",
      session.id === activeId ? "md-session--active" : "",
      dragId === session.id ? "md-session--dragging" : "",
      drop?.id === session.id ? (drop.after ? "md-session--drop-after" : "md-session--drop-before") : "",
    ]
      .filter(Boolean)
      .join(" ");

    return (
      <div
        key={session.id}
        className={classes}
        draggable={canArrange && editingId !== session.id}
        onDragStart={(event) => {
          event.dataTransfer.effectAllowed = "move";
          event.dataTransfer.setData("text/plain", String(session.id));
          setDragId(session.id);
        }}
        onDragOver={(event) => onDragOver(event, session)}
        onDrop={(event) => onDropRow(event, group)}
        onDragEnd={() => {
          setDragId(null);
          setDrop(null);
        }}
      >
        {canArrange ? (
          <button
            type="button"
            className="md-session__grip"
            data-grip={session.id}
            aria-label={`Move ${title}. Use the up and down arrow keys.`}
            title="Drag to reorder (or focus and use ↑ ↓)"
            onKeyDown={(event) => onGripKey(event, session.id, index)}
          >
            <Icon name="grip" size={14} />
          </button>
        ) : null}
        {editingId === session.id ? (
          <span className="md-session__body md-session__body--edit">
            <TitleEditor
              initial={session.title}
              className="md-input md-session__rename"
              onSave={(next) => onRename(session.id, next)}
              onDone={() => setEditingId(null)}
            />
          </span>
        ) : (
          <button
            type="button"
            className="md-session__open"
            onClick={() => onOpen(session.id)}
            onDoubleClick={() => setEditingId(session.id)}
          >
            <span className="md-session__body">
              <span className="md-session__title" title={title}>
                {title}
              </span>
              <span className="md-session__meta">{sessionMeta(session)}</span>
            </span>
          </button>
        )}
        <button
          type="button"
          className={`md-session__del md-session__tool ${session.pinned ? "md-session__tool--on" : ""}`}
          aria-label={session.pinned ? `Unpin ${title}` : `Pin ${title}`}
          aria-pressed={Boolean(session.pinned)}
          title={session.pinned ? "Unpin" : "Pin to top"}
          onClick={() => onPin(session.id, !session.pinned)}
        >
          <Icon name="pin" size={15} />
        </button>
        <button
          type="button"
          className="md-session__del md-session__tool md-session__edit"
          aria-label={`Rename ${title}`}
          title="Rename"
          onClick={() => setEditingId(session.id)}
        >
          <Icon name="edit" size={15} />
        </button>
        <button
          type="button"
          className="md-session__del"
          aria-label={`Delete ${title}`}
          title="Delete"
          onClick={() => setConfirmId(session.id)}
        >
          ✕
        </button>
      </div>
    );
  }

  const count = sessions.length;
  const nothingFound = count > 0 && pinned.length === 0 && rest.length === 0;

  return (
    <aside className="md-chat__aside md-card">
      <div className="md-chat__asidehead">
        <div>
          <span className="md-label">Sessions</span>
          <h2 className="md-chat__heading">Conversations</h2>
        </div>
        <button className="md-btn md-btn--sm md-btn--primary" data-guide="new-chat" onClick={onNew}>
          New
        </button>
      </div>
      <p className="md-chat__asidecopy">
        {count ? `${count} saved session${count === 1 ? "" : "s"} on this board.` : "Start a chat and it stays here until you remove it."}
        {emptyCount ? (
          <>
            {" "}
            <button type="button" className="md-linkbtn" onClick={onClearEmpty}>
              Clear {emptyCount} empty
            </button>
          </>
        ) : null}
      </p>

      {count > 1 ? (
        <div className="md-chat__tools">
          <input
            type="search"
            className="md-input md-chat__find"
            placeholder="Search"
            aria-label="Search sessions"
            value={query}
            onChange={(event) => setQuery(event.target.value)}
          />
          <select
            className="md-input md-chat__sort"
            aria-label="Sort sessions"
            value={sort}
            onChange={(event) => chooseSort(event.target.value as SortKey)}
          >
            {SORTS.map((item) => (
              <option key={item.key} value={item.key}>
                {item.label}
              </option>
            ))}
          </select>
        </div>
      ) : null}

      <div className="md-chat__list" ref={listRef}>
        {count === 0 ? (
          <div className="md-emptycard md-chat__emptyrail">
            <p className="md-muted">No sessions yet.</p>
          </div>
        ) : nothingFound ? (
          <div className="md-emptycard md-chat__emptyrail">
            <p className="md-muted">No session matches “{query.trim()}”.</p>
          </div>
        ) : (
          <>
            {pinned.length ? <span className="md-chat__group">Pinned</span> : null}
            {pinned.map((session, index) => row(session, index, pinned))}
            {pinned.length && rest.length ? <span className="md-chat__group">Sessions</span> : null}
            {rest.map((session, index) => row(session, index, rest))}
          </>
        )}
      </div>
      <span className="md-sr-only" aria-live="polite">
        {announce}
      </span>
    </aside>
  );
}
