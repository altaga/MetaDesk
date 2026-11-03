"use client";

import { useEffect, useRef, useState, type ReactNode } from "react";
import { api } from "@/lib/api";
import { onComposerSeed } from "@/features/desk/composerSeed";
import { onGuide } from "@/features/nova/guideBus";
import type { Tier } from "@/shared/types";
import { Icon } from "@/ui/Icon";
import { RichText } from "./RichText";
import { SessionList, TitleEditor, sessionTitle } from "./SessionList";
import { useChatSession, type ToolRun, type Turn } from "./useChatSession";

const TIERS: Tier[] = ["auto", "local", "fast", "heavy", "ultra"];

/** Slash commands the composer understands. */
const COMMANDS: Array<{ name: string; hint: string }> = [
  { name: "/new", hint: "Start a new chat" },
  { name: "/memory", hint: "Save a shared memory: /memory a fact to remember" },
  { name: "/expert", hint: "Call an expert: /expert Name your question" },
];

/** How many words of a fact become the memory file's title. */
const MEMORY_TITLE_WORDS = 6;

function tierClass(tier?: string | null): string {
  if (tier === "local" || tier === "fast" || tier === "heavy" || tier === "ultra") {
    return `md-chip md-chip--${tier}`;
  }
  return "md-chip";
}

function price(usd?: number | null): string {
  if (usd === null || usd === undefined) return "";
  if (usd === 0) return "free";
  return `$${usd.toFixed(5)}`;
}

const PATCH_STATUS: Record<string, string> = {
  pending: "Waiting for your approval",
  ok: "Applied",
  denied: "Denied — nothing was changed",
};

/** A proposed file change: the diff, and the only buttons that can write it. */
function PatchCard({ run, onDecide }: { run: ToolRun; onDecide?: (approve: boolean) => void }) {
  const lines = (text?: string) => (text ?? "").replace(/\n$/, "").split("\n");
  const pending = run.status === "pending";
  const state = run.status === "error" ? "md-tool--error" : pending ? "md-tool--blocked" : "";
  return (
    <div className={`md-tool md-patch ${state}`}>
      <div className="md-tool__head">
        <span>tool:patch</span>
        <span>{PATCH_STATUS[run.status] ?? run.status}</span>
        {run.reason ? <span>{run.reason}</span> : null}
      </div>
      {run.path ? <div className="md-patch__path">{run.path}</div> : null}
      {run.old !== undefined || run.new !== undefined ? (
        <pre className="md-patch__diff" aria-label={`Proposed change to ${run.path ?? "a file"}`}>
          {lines(run.old).map((line, index) => (
            <span key={`o${index}`} className="md-patch__del">{`- ${line}`}</span>
          ))}
          {lines(run.new).map((line, index) => (
            <span key={`n${index}`} className="md-patch__add">{`+ ${line}`}</span>
          ))}
        </pre>
      ) : null}
      {pending && run.approval_id && onDecide ? (
        <div className="md-patch__actions">
          <span className="md-patch__note">Nothing is written until you approve.</span>
          <button type="button" className="md-btn md-btn--sm md-btn--ghost" disabled={run.deciding} onClick={() => onDecide(false)}>
            Deny
          </button>
          <button type="button" className="md-btn md-btn--sm md-btn--primary" disabled={run.deciding} onClick={() => onDecide(true)}>
            {run.deciding ? "Applying…" : "Approve"}
          </button>
        </div>
      ) : null}
    </div>
  );
}

function ToolCard({ run }: { run: ToolRun }) {
  const state = run.status === "ok" ? "" : run.status === "blocked" ? "md-tool--blocked" : "md-tool--error";
  let body: ReactNode = "";
  if (run.name === "list" && run.entries) {
    body = run.entries.map((entry) => `${entry.type === "dir" ? "▸" : "·"} ${entry.name}`).join("\n");
  } else if (run.name === "read") {
    body = run.truncated ? `${run.content ?? ""}\n… truncated` : run.content ?? "";
  } else if (run.name === "run") {
    body = `${run.command ?? ""}\n${run.output ?? ""}`.trim();
  } else if (run.name === "job") {
    body = run.job
      ? `Background ${run.job.kind} agent queued · ${run.job.id.slice(0, 8)} — watch it in Machine → Agents.`
      : run.detail ?? run.reason ?? "The job could not be queued.";
  } else if (run.name === "search") {
    body = (
      <div className="md-search">
        <div className="md-search__url">{run.query ?? ""}</div>
        {(run.results ?? []).map((hit) => (
          <div key={hit.url} className="md-search__hit">
            <a className="md-search__title" href={hit.url} target="_blank" rel="noreferrer">
              {hit.title || hit.url}
            </a>
            <span className="md-search__url">{hit.url}</span>
            <span className="md-search__snip">{hit.content}</span>
          </div>
        ))}
      </div>
    );
  }
  if (run.name === "run" && run.status === "ok" && !(run.output ?? "").trim()) {
    body = `${run.command ?? ""}\n(no output)`.trim();
  }
  return (
    <div className={`md-tool ${state}`}>
      <div className="md-tool__head">
        <span>tool:{run.name}</span>
        <span>{run.status}</span>
        {run.reason ? <span>{run.reason}</span> : null}
        {typeof run.exit_code === "number" ? <span>exit {run.exit_code}</span> : null}
      </div>
      {body ? <div>{body}</div> : <div>{run.path ?? run.query ?? run.command ?? "no output"}</div>}
    </div>
  );
}

function TurnBlock({
  turn,
  onDecide,
}: {
  turn: Turn;
  onDecide?: (key: string, approvalId: string, approve: boolean) => void;
}) {
  const isUser = turn.role === "user";
  const label = isUser ? "You" : turn.model || "MetaDesk";
  return (
    <div className={`md-turn ${isUser ? "md-turn--user" : "md-turn--assistant"}`}>
      <div className="md-turn__label">
        <span>{label}</span>
        {!isUser && turn.tier ? <span className={tierClass(turn.tier)}>{turn.tier}</span> : null}
      </div>
      {turn.note ? <p className="md-turn__note">{turn.note}</p> : null}
      <div className="md-bubble">
        {turn.text ? <RichText text={turn.text} /> : turn.streaming ? "…" : turn.stopped ? "Stopped before any reply." : ""}
      </div>

      {turn.tools.map((run) =>
        run.name === "patch" ? (
          <PatchCard
            key={run.key}
            run={run}
            onDecide={onDecide && run.approval_id ? (approve) => onDecide(run.key, run.approval_id!, approve) : undefined}
          />
        ) : (
          <ToolCard key={run.key} run={run} />
        ),
      )}

      {!isUser && (turn.model || turn.tokensOut || turn.stopped || turn.costUsd !== null && turn.costUsd !== undefined) ? (
        <div className="md-turn__meta">
          {turn.model ? <span className="md-mono">{turn.model}</span> : null}
          {turn.tokensOut ? <span>{turn.tokensOut} tok</span> : null}
          {turn.costUsd !== null && turn.costUsd !== undefined ? <span>{price(turn.costUsd)}</span> : null}
          {turn.stopped ? <span>stopped</span> : null}
        </div>
      ) : null}
    </div>
  );
}

export function ChatView() {
  const chat = useChatSession();
  const [draft, setDraft] = useState("");
  // The open session's title is being edited in the thread header.
  const [editingHead, setEditingHead] = useState(false);
  const [tier, setTier] = useState<Tier>("auto");
  const [notice, setNotice] = useState<string | null>(null);
  // The highlighted slash command while the menu is open.
  const [cmdIndex, setCmdIndex] = useState(0);
  const scrollRef = useRef<HTMLDivElement | null>(null);
  const boxRef = useRef<HTMLTextAreaElement | null>(null);

  useEffect(() => {
    const node = scrollRef.current;
    if (node) node.scrollTop = node.scrollHeight;
  }, [chat.turns]);

  /** Put text in the composer and the caret at its end, ready to finish and send. */
  function fillDraft(text: string) {
    setDraft(text);
    // The chat may have just been made visible; focus once it has painted.
    window.requestAnimationFrame(() => {
      const box = boxRef.current;
      if (!box) return;
      box.focus();
      box.setSelectionRange(text.length, text.length);
    });
  }

  // Library can hand the composer a prompt (e.g. `@Name ` from an expert).
  useEffect(() => onComposerSeed((seed) => fillDraft(seed.text)), []);

  // Nova can start a fresh session for the operator ("new chat").
  useEffect(
    () =>
      onGuide((request) => {
        if (request.kind === "new_chat") void chat.newSession();
      }),
    [chat.newSession],
  );

  // The composer grows with what is typed (CSS caps it) and shrinks back once sent.
  useEffect(() => {
    const box = boxRef.current;
    if (!box) return;
    box.style.height = "auto";
    box.style.height = `${box.scrollHeight + (box.offsetHeight - box.clientHeight)}px`;
  }, [draft]);

  useEffect(() => {
    if (!notice) return;
    const handle = window.setTimeout(() => setNotice(null), 2200);
    return () => window.clearTimeout(handle);
  }, [notice]);

  const commands =
    draft.startsWith("/") && !draft.includes(" ")
      ? COMMANDS.filter((command) => command.name.startsWith(draft.toLowerCase()))
      : [];
  const activeSession = chat.sessions.find((session) => session.id === chat.activeId) ?? null;
  const cmdPick = commands.length ? commands[Math.min(cmdIndex, commands.length - 1)] : null;

  useEffect(() => setCmdIndex(0), [commands.length]);

  function onKeyDown(event: React.KeyboardEvent<HTMLTextAreaElement>) {
    if (cmdPick) {
      if (event.key === "ArrowDown" || event.key === "ArrowUp") {
        event.preventDefault();
        const step = event.key === "ArrowDown" ? 1 : -1;
        setCmdIndex((index) => (index + step + commands.length) % commands.length);
        return;
      }
      // Enter or Tab completes a partial command; a complete one sends as usual.
      const complete = draft.toLowerCase() === cmdPick.name;
      if (event.key === "Tab" || (event.key === "Enter" && !event.shiftKey && !complete)) {
        event.preventDefault();
        fillDraft(`${cmdPick.name} `);
        return;
      }
      if (event.key === "Escape") {
        event.preventDefault();
        setDraft("");
        return;
      }
    }
    if (event.key === "Enter" && !event.shiftKey) {
      event.preventDefault();
      void submit();
    }
  }

  async function saveMemory(fact: string) {
    const title = fact.split(/\s+/).slice(0, MEMORY_TITLE_WORDS).join(" ");
    try {
      await api.addMemory(title, fact);
      setNotice("Saved to shared memory.");
    } catch (err) {
      setNotice(err instanceof Error ? err.message : "Could not save the memory.");
    }
  }

  async function submit() {
    const raw = draft.trim();
    if (!raw || chat.busy) return;
    if (raw === "/") return;

    if (raw === "/new") {
      setDraft("");
      await chat.newSession();
      return;
    }
    if (raw === "/memory" || raw === "/expert") {
      setNotice(`Usage: ${COMMANDS.find((command) => command.name === raw)?.hint ?? raw}`);
      return;
    }
    if (raw.startsWith("/memory ")) {
      const fact = raw.slice("/memory ".length).trim();
      if (!fact) return;
      setDraft("");
      await saveMemory(fact);
      return;
    }
    if (raw.startsWith("/expert ")) {
      const rest = raw.slice("/expert ".length).trim();
      const name = rest.split(/\s+/)[0] ?? "";
      if (!name) return;
      setDraft("");
      await chat.send(`@${name} ${rest.slice(name.length).trim()}`.trim(), tier);
      return;
    }

    setDraft("");
    await chat.send(raw, tier);
  }

  return (
    <div className="md-chat">
      <SessionList
        sessions={chat.sessions}
        activeId={chat.activeId}
        onOpen={(id) => void chat.openSession(id)}
        onNew={() => void chat.newSession()}
        onRename={(id, title) => void chat.renameSession(id, title)}
        onPin={(id, pinned) => void chat.pinSession(id, pinned)}
        onDelete={(id) => void chat.removeSession(id)}
        onReorder={(ids) => void chat.reorderSessions(ids)}
        onClearEmpty={() => void chat.clearEmptySessions()}
      />

      <section className="md-thread" data-guide="thread">
        <div className="md-thread__head">
          <div>
            <span className="md-label">Chat</span>
            {activeSession && editingHead ? (
              <TitleEditor
                initial={activeSession.title}
                className="md-input md-chat__rename"
                onSave={(title) => void chat.renameSession(activeSession.id, title)}
                onDone={() => setEditingHead(false)}
              />
            ) : (
              <h1 className="md-chat__heading md-chat__titlewrap">
                <span className="md-chat__titletext" title={activeSession ? sessionTitle(activeSession.title) : undefined}>
                  {activeSession ? sessionTitle(activeSession.title) : "New session"}
                </span>
                {activeSession ? (
                  <button
                    type="button"
                    className="md-chat__titleedit"
                    aria-label="Rename this session"
                    title="Rename"
                    onClick={() => setEditingHead(true)}
                  >
                    <Icon name="edit" size={16} />
                  </button>
                ) : null}
              </h1>
            )}
          </div>
          <p className="md-thread__sub">
            {chat.busy
              ? "The board is replying now."
              : "Send one turn at a time. Tool activity stays in the transcript."}
          </p>
        </div>
        <div className="md-thread__scroll" ref={scrollRef} role="region" aria-label="Conversation" tabIndex={0}>
          {chat.turns.length === 0 ? (
            <div className="md-empty">
              <p>
                Ask the board something. Try{" "}
                <button type="button" className="md-example" onClick={() => fillDraft("list the workspace")}>
                  list the workspace
                </button>{" "}
                or{" "}
                <button type="button" className="md-example" onClick={() => fillDraft("read README.md")}>
                  read README.md
                </button>{" "}
                and watch the tools run.
              </p>
            </div>
          ) : (
            chat.turns.map((turn) => (
              <TurnBlock
                key={turn.id}
                turn={turn}
                onDecide={(key, approvalId, approve) => void chat.decideTool(turn.id, key, approvalId, approve)}
              />
            ))
          )}
        </div>

        <form
          className="md-composer"
          onSubmit={(event) => {
            event.preventDefault();
            void submit();
          }}
        >
          {chat.error ? (
            <p className="md-error" role="alert">
              {chat.error}
            </p>
          ) : null}
          {/* Always mounted so screen readers announce a new notice. */}
          <p className="md-note" role="status">
            {notice ?? ""}
          </p>

          <div className="md-composer__meta">
            <div className="md-tierpick" data-guide="model-picker" role="group" aria-label="Model tier">
              {TIERS.map((option) => (
                <button
                  key={option}
                  type="button"
                  aria-pressed={tier === option}
                  onClick={() => setTier(option)}
                >
                  {option}
                </button>
              ))}
            </div>
            <span className="md-composer__hint">Enter sends · Shift+Enter adds a new line</span>
          </div>

          {commands.length > 0 ? (
            <ul className="md-cmds" id="md-cmds" role="listbox" aria-label="Commands">
              {commands.map((command) => (
                <li
                  key={command.name}
                  id={`md-cmd-${command.name.slice(1)}`}
                  role="option"
                  aria-selected={command === cmdPick}
                  className={`md-cmds__item ${command === cmdPick ? "md-cmds__item--on" : ""}`}
                  // Keep focus in the composer while picking with the mouse.
                  onMouseDown={(event) => event.preventDefault()}
                  onClick={() => fillDraft(`${command.name} `)}
                >
                  <span className="md-mono">{command.name}</span>
                  <span className="md-muted">{command.hint}</span>
                </li>
              ))}
            </ul>
          ) : null}

          <div className="md-composer__row" data-guide="composer">
            <textarea
              ref={boxRef}
              className="md-composer__box"
              placeholder="Message the desk…"
              aria-label="Message the desk"
              aria-autocomplete="list"
              aria-controls={cmdPick ? "md-cmds" : undefined}
              aria-activedescendant={cmdPick ? `md-cmd-${cmdPick.name.slice(1)}` : undefined}
              value={draft}
              onChange={(event) => setDraft(event.target.value)}
              onKeyDown={onKeyDown}
              rows={1}
            />
            {chat.busy ? (
              <button className="md-btn" type="button" onClick={chat.cancel}>
                Stop reply
              </button>
            ) : (
              <button className="md-btn md-btn--primary" type="submit" disabled={!draft.trim()}>
                Send
              </button>
            )}
          </div>
        </form>
      </section>
    </div>
  );
}
