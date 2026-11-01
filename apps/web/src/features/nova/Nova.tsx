"use client";

import { useCallback, useEffect, useRef, useState, type CSSProperties } from "react";
import { ensureSession } from "@/lib/session";
import { LIBRARY_TARGET, emitGuide, spotlight, type DeskView, type GuideRequest } from "./guideBus";

type Line = { from: "nova" | "you"; text: string };
type Mood = "calm" | "joy" | "think" | "sorry";
type Action = { type: string; target?: string; emotion?: string; board?: string };

const VIEW_NAME: Record<DeskView, string> = {
  chat: "Chat",
  machine: "Machine",
  board: "Board",
  library: "Library",
  fleet: "Fleet",
};

/** What Nova says when the panel opens, per view. Local, so it costs nothing. */
const HELLO: Record<DeskView, string> = {
  chat: "Hi, I'm Nova. Ask me where anything is, or take the tour — I'll open screens and point at things for you.",
  machine: "This is the machine itself: files, a real shell, background agents, missions and the board's browser.",
  board: "Live telemetry from the board. If the temperature climbs, move heavy turns to a cloud tier.",
  library: "Secrets, experts and shared memory live here, on the board. Every chat can use them.",
  fleet: "Every Jetson on your account. Pick one to drive it, or add another in three steps.",
};

/** How many lines the panel keeps before the oldest ones drop off. */
const MAX_LINES = 40;

const SUGGEST = ["Take the tour", "Where is the terminal?", "Which board is this?", "How do I add a Jetson?"];

type TourStep = { say: string; go: GuideRequest; target: string };

/** The tour runs locally: no model call, no tokens. */
const TOUR: TourStep[] = [
  { say: "This is where you talk to the board. Type a task and press Enter.", go: { kind: "view", view: "chat" }, target: "chat.composer" },
  { say: "Pin a tier here. Local runs on the Jetson for free; fast and heavy call Muse through the Meta Model API.", go: { kind: "view", view: "chat" }, target: "chat.model_picker" },
  { say: "A real shell on the board. It opens in your home folder.", go: { kind: "machine_tab", tab: "terminal" }, target: "machine.terminal" },
  { say: "Browse and read the files under the desk root.", go: { kind: "machine_tab", tab: "files" }, target: "machine.files" },
  { say: "Live CPU, memory, disk, temperature and GPU from the Jetson.", go: { kind: "view", view: "board" }, target: "machine.health" },
  { say: "Store a secret once and chats use it by name. The value never comes back out.", go: { kind: "view", view: "library" }, target: "board.secrets" },
  { say: "And this is how you add another Jetson. That's the tour — ask me anything else.", go: { kind: "view", view: "fleet" }, target: "nav.pair" },
];

/** The suggested questions have fixed answers, so they run locally like the tour. */
const QUICK: Record<string, { say: (board: string) => string; go?: GuideRequest; target: string }> = {
  "where is the terminal?": {
    say: () => "Machine → Terminal: a real shell on the board, opened in your home folder.",
    go: { kind: "machine_tab", tab: "terminal" },
    target: "machine.terminal",
  },
  "which board is this?": {
    say: (board) => (board ? `You're driving ${board}. Switch boards from Fleet.` : "No board is selected yet. Pick or add one in Fleet."),
    target: "nav.fleet",
  },
  "how do i add a jetson?": {
    say: () => "In Fleet, press Set up a board: plug the Jetson in by USB, give it a name and confirm the Pair ID it shows.",
    go: { kind: "view", view: "fleet" },
    target: "nav.pair",
  },
};

/** Where the panel may sit, nearest to its home spot first. */
const SPOTS: CSSProperties[] = [
  {},
  { left: "auto", right: 24 },
  { top: 24, bottom: "auto" },
  { top: 24, bottom: "auto", left: "auto", right: 24 },
];

const MOOD: Record<string, Mood> = {
  happy: "joy", excited: "joy", love: "joy", laugh: "joy", wink: "joy", cat: "joy", smug: "joy",
  neutral: "calm", relaxed: "calm", sleepy: "calm", shy: "calm",
  thinking: "think", determined: "think", surprised: "think", flustered: "think",
  apologetic: "sorry", sad: "sorry", pout: "sorry",
};

const ERRORS: Record<string, string> = {
  subscription_inactive: "I need an active MetaDesk plan to answer that. The tour still works.",
  cloud_credit_used: "Today's cloud credit is used up, so I can't answer right now. The tour still works.",
  gateway_unconfigured: "The Meta Model API key isn't set on the Worker yet, so I can't think out loud. The tour still works.",
  board_not_found: "I can't find the selected board in your fleet. Pick one in Fleet and ask again.",
  empty_reply: "I lost my words for a second. Ask me again?",
  meta_error: "Muse didn't answer just now, so I can't reply to that. The tour and the questions below still work.",
};

/** Point at a target; Library targets open their shelf first. */
function point(target: string) {
  const shelf = LIBRARY_TARGET[target];
  if (shelf) emitGuide({ kind: "library_tab", tab: shelf });
  // Let the view mount before pointing at something inside it.
  window.setTimeout(() => spotlight(target), 450);
}

/** Turn one guide action into a desk move. Unknown actions are ignored. */
function apply(action: Action, setMood: (mood: Mood) => void) {
  const go = (request: GuideRequest) => emitGuide(request);
  switch (action.type) {
    case "react":
      setMood(MOOD[action.emotion ?? ""] ?? "calm");
      return;
    case "open_chat":
      return go({ kind: "view", view: "chat" });
    case "new_chat":
      return go({ kind: "new_chat" });
    case "open_machine":
      return go({ kind: "view", view: "machine" });
    case "open_terminal":
      return go({ kind: "machine_tab", tab: "terminal" });
    case "open_files":
      return go({ kind: "machine_tab", tab: "files" });
    case "open_browser":
    case "open_services":
      return go({ kind: "machine_tab", tab: "preview" });
    case "open_health":
    case "open_plan":
      return go({ kind: "view", view: "board" });
    case "open_board":
    case "open_panel":
      return go({ kind: "view", view: "library" });
    case "open_nav":
      return go({ kind: "view", view: "fleet" });
    case "select_board":
      if (action.board) go({ kind: "select_board", name: action.board });
      return;
    case "highlight":
      if (action.target) point(action.target);
      return;
  }
}

/**
 * Nova, the desk guide. A Muse-powered helper that answers questions about
 * the desk and moves it for you: she opens screens and points at things, but
 * never runs commands or writes anything. Every turn goes to the Worker and
 * Muse Spark directly; she never talks to the board, so she works with no
 * board paired or with the board offline.
 */
export function Nova({ view, deviceId, board = "" }: { view: DeskView; deviceId: string | null; board?: string }) {
  const [open, setOpen] = useState(false);
  const [lines, setLines] = useState<Line[]>([]);
  const [draft, setDraft] = useState("");
  const [busy, setBusy] = useState(false);
  const [mood, setMood] = useState<Mood>("calm");
  const [tour, setTour] = useState<number | null>(null);
  // Moves the panel off whatever Nova is pointing at.
  const [spot, setSpot] = useState<CSSProperties>({});
  const sessionRef = useRef<string | null>(null);
  const rootRef = useRef<HTMLDivElement | null>(null);
  const scrollRef = useRef<HTMLDivElement | null>(null);
  const inputRef = useRef<HTMLInputElement | null>(null);
  const buttonRef = useRef<HTMLButtonElement | null>(null);

  const close = useCallback(() => {
    setOpen(false);
    setTour(null);
    setSpot({});
    buttonRef.current?.focus();
  }, []);

  // Opened from the keyboard, the caret goes into the panel (a mouse open leaves
  // focus alone so the panel can stay faded); closing hands focus back.
  const focusOnOpen = useRef(false);
  useEffect(() => {
    if (open && focusOnOpen.current) inputRef.current?.focus();
  }, [open]);

  /** Point at a target, then park the panel where it covers the least of it. */
  const pointAway = useCallback((target: string) => {
    point(target);
    window.setTimeout(() => {
      const ring = document.querySelector<HTMLElement>(".md-guide-spot");
      const panel = rootRef.current?.querySelector<HTMLElement>(".md-nova__panel");
      if (!ring || !panel || window.innerWidth <= 900) return;
      const goal = ring.getBoundingClientRect();
      const width = panel.offsetWidth;
      const height = panel.offsetHeight;
      const home = { left: 284, top: window.innerHeight - 24 - height };
      const boxes = [
        home,
        { left: window.innerWidth - 24 - width, top: home.top },
        { left: home.left, top: 24 },
        { left: window.innerWidth - 24 - width, top: 24 },
      ];
      const overlap = (box: { left: number; top: number }) =>
        Math.max(0, Math.min(box.left + width, goal.right) - Math.max(box.left, goal.left)) *
        Math.max(0, Math.min(box.top + height, goal.bottom) - Math.max(box.top, goal.top));
      const scores = boxes.map(overlap);
      setSpot(SPOTS[scores.indexOf(Math.min(...scores))]);
    }, 900);
  }, []);

  // Greet once per view change while the panel is closed, so it opens on topic.
  useEffect(() => {
    if (!open) setLines([{ from: "nova", text: HELLO[view] }]);
  }, [view, open]);

  useEffect(() => {
    scrollRef.current?.scrollTo({ top: scrollRef.current.scrollHeight, behavior: "smooth" });
  }, [lines]);

  // The conversation is a guide's, not an archive: keep only the latest lines.
  useEffect(() => {
    if (lines.length > MAX_LINES) setLines((prev) => prev.slice(-MAX_LINES));
  }, [lines]);

  useEffect(() => {
    if (!open) return;
    const onKey = (event: KeyboardEvent) => {
      if (event.key === "Escape") close();
    };
    document.addEventListener("keydown", onKey);
    return () => document.removeEventListener("keydown", onKey);
  }, [open, close]);

  const say = useCallback((text: string) => setLines((prev) => [...prev, { from: "nova", text }]), []);

  const runTour = useCallback(
    (step: number) => {
      if (step >= TOUR.length) {
        setTour(null);
        setSpot({});
        return;
      }
      const item = TOUR[step];
      setTour(step);
      setMood(step === TOUR.length - 1 ? "joy" : "calm");
      emitGuide(item.go);
      pointAway(item.target);
      say(item.say);
    },
    [say, pointAway],
  );

  async function ask(content: string) {
    const text = content.trim();
    if (!text || busy) return;
    if (/^take the tour$|^tour$|^\/tour$/i.test(text)) {
      setLines((prev) => [...prev, { from: "you", text }]);
      setDraft("");
      runTour(0);
      return;
    }
    const quick = QUICK[text.toLowerCase()];
    if (quick) {
      setTour(null);
      setDraft("");
      setLines((prev) => [...prev, { from: "you", text }, { from: "nova", text: quick.say(board) }]);
      setMood("calm");
      if (quick.go) emitGuide(quick.go);
      pointAway(quick.target);
      return;
    }
    setTour(null);
    setLines((prev) => [...prev, { from: "you", text }, { from: "nova", text: "" }]);
    setDraft("");
    setBusy(true);
    setMood("think");
    try {
      // Cloud only: the turn goes straight to the Worker and Muse. The selected
      // board's id is sent as context; nothing here calls the board itself.
      const body = JSON.stringify({
        content: text,
        device_id: deviceId ?? undefined,
        session_id: sessionRef.current,
      });
      let res = await post(body);
      if (res.status === 401 && (await ensureSession())) res = await post(body);
      if (!res.ok || !res.body) {
        replaceLast("I couldn't reach the guide service. Try again in a moment — the tour still works offline.");
        setMood("sorry");
        return;
      }
      await readStream(res.body);
    } catch {
      replaceLast("I couldn't reach the guide service. Try again in a moment — the tour still works offline.");
      setMood("sorry");
    } finally {
      setBusy(false);
    }
  }

  function post(body: string) {
    return fetch("/api/desk/v1/guide/message/stream", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body,
      cache: "no-store",
    });
  }

  function replaceLast(text: string) {
    setLines((prev) => [...prev.slice(0, -1), { from: "nova", text }]);
  }

  async function readStream(stream: ReadableStream<Uint8Array>) {
    const reader = stream.getReader();
    const decoder = new TextDecoder();
    let buffer = "";
    let spoken = "";
    let moodSet = false;
    for (;;) {
      const { value, done } = await reader.read();
      if (done) break;
      buffer += decoder.decode(value, { stream: true });
      let cut = buffer.indexOf("\n\n");
      while (cut !== -1) {
        const frame = buffer.slice(0, cut).trim();
        buffer = buffer.slice(cut + 2);
        cut = buffer.indexOf("\n\n");
        if (!frame.startsWith("data:")) continue;
        let event: { type: string; [key: string]: unknown };
        try {
          event = JSON.parse(frame.slice(5).trim());
        } catch {
          continue;
        }
        if (event.type === "start" && typeof event.session_id === "string") sessionRef.current = event.session_id;
        if (event.type === "delta" && typeof event.text === "string") {
          spoken += event.text;
          replaceLast(spoken);
        }
        if (event.type === "action" && event.action) {
          const action = event.action as Action;
          if (action.type === "react") moodSet = true;
          apply(action, setMood);
        }
        if (event.type === "error") {
          replaceLast(ERRORS[String(event.detail)] ?? "Something went wrong on my side. Try again in a moment.");
          setMood("sorry");
          return;
        }
      }
    }
    if (!spoken) replaceLast("Done.");
    if (!moodSet) setMood("calm");
  }

  return (
    <div className="md-nova" ref={rootRef} data-mood={mood} data-busy={busy || undefined}>
      {open ? (
        <section
          className="md-nova__panel"
          role="dialog"
          aria-label="Nova, the desk guide"
          style={spot}
          data-tour={tour !== null || undefined}
        >
          <header className="md-nova__head">
            <span className="md-orb md-orb--sm" aria-hidden="true" />
            <div className="md-nova__who">
              <strong>Nova</strong>
              <span>Desk guide · {VIEW_NAME[view]} · Muse Spark</span>
            </div>
            <button type="button" className="md-iconbtn" aria-label="Close Nova" onClick={close}>
              <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" aria-hidden="true">
                <path d="M6 6l12 12M18 6L6 18" />
              </svg>
            </button>
          </header>

          <div className="md-nova__log" ref={scrollRef} aria-live="polite" tabIndex={0}>
            {lines.map((line, index) => (
              <p key={index} className={`md-nova__line md-nova__line--${line.from}`}>
                {line.text || <span className="md-nova__dots" aria-label="Nova is thinking"><i /><i /><i /></span>}
              </p>
            ))}
          </div>

          {tour !== null ? (
            <div className="md-nova__tour">
              <span>
                Step {tour + 1} of {TOUR.length}
              </span>
              <div>
                <button
                  type="button"
                  className="md-btn md-btn--sm md-btn--ghost"
                  onClick={() => {
                    setTour(null);
                    setSpot({});
                  }}
                >
                  End tour
                </button>
                <button type="button" className="md-btn md-btn--sm md-btn--primary" onClick={() => runTour(tour + 1)}>
                  {tour === TOUR.length - 1 ? "Finish" : "Next"}
                </button>
              </div>
            </div>
          ) : (
            <div className="md-nova__chips">
              {SUGGEST.map((item) => (
                <button key={item} type="button" className="md-nova__chip" disabled={busy} onClick={() => void ask(item)}>
                  {item}
                </button>
              ))}
            </div>
          )}

          <form
            className="md-nova__form"
            onSubmit={(event) => {
              event.preventDefault();
              void ask(draft);
            }}
          >
            <input
              ref={inputRef}
              className="md-input"
              value={draft}
              onChange={(event) => setDraft(event.target.value)}
              placeholder="Ask Nova…"
              aria-label="Ask Nova"
              maxLength={4000}
              disabled={busy}
            />
            <button type="submit" className="md-nova__send" disabled={busy || !draft.trim()} aria-label="Send to Nova">
              <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
                <path d="M12 19V5M5 12l7-7 7 7" />
              </svg>
            </button>
          </form>
        </section>
      ) : null}

      <button
        ref={buttonRef}
        type="button"
        className={`md-nova__btn ${open ? "md-nova__btn--on" : ""}`}
        aria-expanded={open}
        aria-label={open ? "Close Nova" : "Ask Nova"}
        onClick={(event) => {
          if (open) return close();
          focusOnOpen.current = event.detail === 0;
          setOpen(true);
        }}
      >
        <span className="md-orb" aria-hidden="true" />
        <span className="md-nova__label">Ask Nova</span>
      </button>
    </div>
  );
}
