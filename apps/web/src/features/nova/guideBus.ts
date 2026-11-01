/**
 * Nova's hands: a module-level bus that lets the guide move the desk without
 * a provider, in the same spirit as `composerSeed`. Views subscribe to the
 * requests they own; Nova only ever navigates and points.
 */

export type DeskView = "chat" | "machine" | "board" | "library" | "fleet";
export type MachineTab = "files" | "terminal" | "agents" | "missions" | "preview";
export type LibraryTab = "secrets" | "experts" | "memory";

export type GuideRequest =
  | { kind: "view"; view: DeskView }
  | { kind: "machine_tab"; tab: MachineTab }
  | { kind: "library_tab"; tab: LibraryTab }
  | { kind: "new_chat" }
  | { kind: "select_board"; name: string };

const listeners = new Set<(request: GuideRequest) => void>();

/**
 * The Machine view mounts after the request that opens it, so a tab ask is
 * also parked here for it to pick up on mount.
 */
let pendingTab: MachineTab | null = null;
let pendingLibraryTab: LibraryTab | null = null;

export function emitGuide(request: GuideRequest): void {
  if (request.kind === "machine_tab") pendingTab = request.tab;
  if (request.kind === "library_tab") pendingLibraryTab = request.tab;
  listeners.forEach((listener) => listener(request));
}

export function onGuide(listener: (request: GuideRequest) => void): () => void {
  listeners.add(listener);
  return () => {
    listeners.delete(listener);
  };
}

/** Read and clear the tab Nova asked for before the Machine view existed. */
export function takePendingTab(): MachineTab | null {
  const tab = pendingTab;
  pendingTab = null;
  return tab;
}

/** Same as `takePendingTab`, for the Library shelves. */
export function takePendingLibraryTab(): LibraryTab | null {
  const tab = pendingLibraryTab;
  pendingLibraryTab = null;
  return tab;
}

/** Targets that live on a Library shelf, and which shelf to open first. */
export const LIBRARY_TARGET: Record<string, LibraryTab> = {
  "board.secrets": "secrets",
  "board.experts": "experts",
  "board.memory": "memory",
};

/** Guide targets resolve to `data-guide` tokens; one element can answer several. */
const TARGET_TOKEN: Record<string, string> = {
  "nav.fleet": "nav-fleet",
  "nav.open_machine": "nav-machine",
  "nav.new_chat": "new-chat",
  "nav.pair": "pair",
  "machine.health": "health",
  "machine.terminal": "terminal",
  "machine.files": "files",
  "machine.services": "preview",
  "panel.chat": "thread",
  "panel.board": "health",
  "panel.plan": "health",
  "board.status": "health",
  "board.memory": "memory",
  "board.experts": "experts",
  "board.secrets": "secrets",
  "chat.model_picker": "model-picker",
  "chat.composer": "composer",
};

/** Ring the element for a few seconds and bring it into view. */
export function spotlight(target: string): boolean {
  const token = TARGET_TOKEN[target] ?? target;
  const el = document.querySelector<HTMLElement>(`[data-guide~="${token}"]`);
  if (!el) return false;
  document.querySelectorAll(".md-guide-spot").forEach((node) => node.classList.remove("md-guide-spot"));
  el.scrollIntoView({ behavior: "smooth", block: "center" });
  el.classList.remove("md-guide-spot");
  // Restart the animation when the same element is pointed at twice.
  void el.offsetWidth;
  el.classList.add("md-guide-spot");
  window.setTimeout(() => el.classList.remove("md-guide-spot"), 3600);
  return true;
}
