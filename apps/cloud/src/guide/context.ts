import type { DeviceRow, DeviceView } from "../devices/service";
import { deviceView } from "../devices/service";
import type { Balance } from "../subscription/service";

export type DeskHints = {
  secret_names?: string[];
  expert_names?: string[];
};

const UI_LEGEND =
  "UI: Chat=talk to the board LLM (model picker). Machine=Files, Terminal (shell on the board), " +
  "Agents, Missions, Preview (the board's browser). Board=live health: CPU GPU RAM temp disk. " +
  "Library=Secrets (stored once, chats use them by name; values never shown), Experts (saved " +
  "prompts the operator can call), Memory (shared memory: facts every chat on this board reads). " +
  "Fleet=boards and Set up a board. " +
  "Credits are answered from context; there is no Plan screen.";

function clipNames(raw: unknown, max = 16): string[] {
  if (!Array.isArray(raw)) return [];
  const out: string[] = [];
  for (const item of raw) {
    if (typeof item !== "string") continue;
    const name = item.trim().slice(0, 40);
    if (!name || !/^[A-Za-z0-9_.:-]+$/.test(name)) continue;
    out.push(name);
    if (out.length >= max) break;
  }
  return out;
}

export function sanitizeDeskHints(raw: unknown): DeskHints {
  if (!raw || typeof raw !== "object" || Array.isArray(raw)) return {};
  const row = raw as Record<string, unknown>;
  return {
    secret_names: clipNames(row.secret_names),
    expert_names: clipNames(row.expert_names),
  };
}

function modelLines(boardEmu: boolean): string {
  if (boardEmu) {
    return (
      "Chat models (cloud-only board-emu): fast (Muse Spark), heavy (Muse Wonder). " +
      "No Local/Auto on this board."
    );
  }
  return (
    "Chat models: Auto (routes), Local (processed on the board), fast (Muse Spark), " +
    "heavy (Muse Wonder). Pick in the Chat model picker."
  );
}

/** Compact desk snapshot for Nova — keep under ~800 tokens. */
export function buildDeskContext(
  fleet: DeviceView[],
  selected: DeviceRow | null,
  bal: Balance,
  hints: DeskHints = {}
): string {
  const view = selected ? deviceView(selected) : null;
  const online = fleet.filter((d) => d.status === "online");
  const lines = fleet.map((d) => `${d.name} (${d.status}${d.id === selected?.id ? ", selected" : ""})`);
  const secrets = hints.secret_names?.length ? hints.secret_names.join(", ") : "(not listed: open Library to see them)";
  const experts = hints.expert_names?.length ? hints.expert_names.join(", ") : "(not listed: open Library to see them)";

  return [
    `Fleet: ${fleet.length} board(s), ${online.length} online.`,
    lines.length ? `Boards: ${lines.join("; ")}.` : "Boards: none paired.",
    view
      ? `Selected board: ${view.name}. status=${view.status}. hostname=${view.hostname || "unknown"}. ` +
        `remote_access=${view.remote_enabled ? "on" : "off"}. ${view.board_emu ? "kind=board-emu (cloud chat only)." : "kind=jetson."}`
      : "Selected board: none. Help with the desk in general and point to Fleet to add a board.",
    modelLines(Boolean(view?.board_emu)),
    `Credits: cloud $${bal.cloud_remaining_usd.toFixed(2)} left of $${bal.cloud_credit_usd.toFixed(2)}; ` +
      `search ${bal.tavily_credits_remaining}/${bal.tavily_credits} left. plan=${bal.plan_name} (${bal.status}).`,
    `Secrets (names only, never values): ${secrets}.`,
    `Experts/brains: ${experts}.`,
    UI_LEGEND,
    "Answer factual questions from this context. Navigate only when asked to open/show a screen.",
  ].join(" ");
}
