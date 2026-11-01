const TYPES = new Set([
  "open_chat",
  "new_chat",
  "open_machine",
  "open_terminal",
  "open_files",
  "open_browser",
  "open_services",
  "open_health",
  "open_panel",
  "open_board",
  "open_plan",
  "open_nav",
  "select_board",
  "highlight",
  "react",
]);

const EMOTIONS = new Set([
  "neutral",
  "happy",
  "excited",
  "love",
  "shy",
  "surprised",
  "relaxed",
  "sleepy",
  "wink",
  "thinking",
  "laugh",
  "cat",
  "determined",
  "smug",
  "apologetic",
  "pout",
  "flustered",
  "sad",
]);

const TARGETS = new Set([
  "nav.fleet",
  "nav.open_machine",
  "nav.new_chat",
  "nav.pair",
  "machine.health",
  "machine.terminal",
  "machine.files",
  "machine.browser",
  "machine.services",
  "panel.chat",
  "panel.board",
  "panel.plan",
  "board.status",
  "board.memory",
  "board.experts",
  "board.secrets",
  "chat.model_picker",
  "chat.composer",
]);

export type GuideAction = { type: string; target?: string; emotion?: string; board?: string };

function normalize(item: unknown): GuideAction | null {
  if (!item || typeof item !== "object") return null;
  const row = item as { type?: unknown; target?: unknown; emotion?: unknown; name?: unknown; board?: unknown };
  if (typeof row.type !== "string" || !TYPES.has(row.type)) return null;
  // Alias: open_services === open_browser (Services tab).
  const type = row.type === "open_services" ? "open_browser" : row.type;
  if (type === "highlight") {
    if (typeof row.target !== "string" || !TARGETS.has(row.target)) return null;
    const target = row.target === "machine.browser" ? "machine.services" : row.target;
    return { type: "highlight", target };
  }
  if (type === "react") {
    const emotion = typeof row.emotion === "string" ? row.emotion : typeof row.name === "string" ? row.name : null;
    if (!emotion || !EMOTIONS.has(emotion)) return null;
    return { type: "react", emotion };
  }
  if (type === "select_board") {
    const board = typeof row.board === "string" ? row.board : typeof row.name === "string" ? row.name : null;
    if (!board || !board.trim() || board.trim().length > 64) return null;
    return { type: "select_board", board: board.trim() };
  }
  return { type };
}

function ingest(parsed: unknown, into: GuideAction[]): void {
  const list = Array.isArray(parsed)
    ? parsed
    : parsed && typeof parsed === "object" && Array.isArray((parsed as { actions?: unknown }).actions)
      ? (parsed as { actions: unknown[] }).actions
      : [parsed];
  for (const item of list) {
    const clean = normalize(item);
    if (clean) into.push(clean);
  }
}

/** Strip ```guide fences (and bare action JSON); return display text + allowlisted actions. */
export function parseGuideReply(text: string): { text: string; actions: GuideAction[] } {
  const actions: GuideAction[] = [];
  let cleaned = text.replace(/```guide\s*([\s\S]*?)```/gi, (_m, body: string) => {
    try {
      ingest(JSON.parse(String(body).trim()), actions);
    } catch {
      /* ignore */
    }
    return "";
  });
  cleaned = cleaned.replace(/```guide\s*[\s\S]*$/i, "");
  cleaned = cleaned.replace(/^\s*\d+[.)]\s+/gm, "");
  cleaned = cleaned.replace(/\n{3,}/g, "\n\n").trim();
  if (!actions.length && (cleaned.startsWith("{") || cleaned.startsWith("["))) {
    try {
      const parsed = JSON.parse(cleaned);
      const before = actions.length;
      ingest(parsed, actions);
      if (actions.length > before) cleaned = "";
    } catch {
      /* keep */
    }
  }
  return { text: cleaned, actions };
}

/** Greetings/thanks should never yank the UI around. */
export function isSocialTurn(userText: string): boolean {
  const t = userText.trim().toLowerCase();
  if (!t || t.length > 80) return false;
  // Short hellos — including typos like "Hello Mills" / "hi milli".
  if (/^(hola|hi+|hello|hey|buenas|buen día|buen dia|qué tal|que tal)([\s,!.?]|$)/i.test(t)) return true;
  if (/^(hola|hi+|hello|hey)\b.{0,24}\bmill(ie|s|i|y)?\b/i.test(t)) return true;
  if (/^(gracias|thanks|thank you|ty|de nada)([\s,!.?]|$)/i.test(t)) return true;
  if (/^gracias\b.{0,24}\bmill(ie|s|i|y)?\b/i.test(t)) return true;
  return false;
}

function socialCaption(userText: string, spanish: boolean): string {
  const t = userText.trim().toLowerCase();
  if (/^(gracias|thanks|thank you|ty)\b/i.test(t)) {
    return spanish ? "¡De nada! ¿Qué más necesitas?" : "Anytime — what else do you need?";
  }
  return spanish
    ? "¡Hola! Soy Nova — ¿en qué te ayudo?"
    : "Hey! I'm Nova — what do you need?";
}

/** "Which board/machine is open?" — answer the name; do not open Terminal. */
export function isCurrentBoardQuestion(userText: string): boolean {
  const t = userText.trim().toLowerCase();
  if (!t) return false;
  const aboutDevice = /\b(m[aá]quina|machine|board|jetson|dispositivo|device)\b/.test(t);
  if (!aboutDevice) return false;
  if (/\b(terminal|shell|comando|archivo|files|health|temp)\b/.test(t)) return false;
  const asking =
    /\b(qu[eé]|which|what|cu[aá]l)\b/.test(t) ||
    /\b(abierta|abierto|open|actual|ahorita|ahora|current|selected|seleccionad)\b/.test(t);
  return asking && (/\b(abierta|abierto|open|actual|ahorita|ahora|current|selected|seleccionad|usando|using)\b/.test(t) ||
    /\b(qu[eé]|which|what|cu[aá]l)\b.*\b(m[aá]quina|machine|board)\b/.test(t));
}

/** Spoken caption when the model navigates but forgets to say anything (or echoes the user). */
export function captionFromActions(actions: GuideAction[], spanish: boolean): string {
  const nav = actions.filter((a) => a.type !== "react");
  if (!nav.length) {
    return spanish ? "Aquí estoy — pregunta dónde está algo." : "I'm here — ask me where something is.";
  }
  const primary = nav.find((a) => a.type.startsWith("open_")) || nav[0];
  const switched = actions.find((a) => a.type === "select_board" && a.board);
  if (spanish) {
    if (switched?.board && nav.some((a) => a.type === "open_terminal")) {
      return `¡Listo! Abrí la Terminal de ${switched.board}.`;
    }
    if (switched?.board && nav.some((a) => a.type === "open_browser" || a.type === "open_services")) {
      return `¡Listo! Abrí Services de ${switched.board}.`;
    }
    if (switched?.board && nav.some((a) => a.type === "open_health")) {
      return `¡Listo! Abrí Health de ${switched.board}.`;
    }
    if (switched?.board && nav.some((a) => a.type === "open_files")) {
      return `¡Listo! Abrí Files de ${switched.board}.`;
    }
    if (switched?.board) return `¡Hecho! Cambié a ${switched.board}.`;
    const es: Record<string, string> = {
      open_chat: "¡Claro! Aquí está el Chat.",
      new_chat: "¡Listo! Chat nuevo para ti.",
      open_machine: "¡Claro! Aquí está Machine.",
      open_health: "¡Listo! Aquí está Health.",
      open_terminal: "¡Listo! Aquí está la Terminal.",
      open_files: "¡Claro! Aquí están los Files.",
      open_browser: "¡Listo! Aquí está Services.",
      open_services: "¡Listo! Aquí está Services.",
      open_panel: "¡Hecho! Abrí el panel.",
      open_board: "¡Claro! Aquí está el panel Board.",
      open_plan: "¡Listo! Aquí está tu Plan.",
      open_nav: "¡Claro! Abrí el menú.",
      highlight: "¡Aquí! Te lo señalo.",
    };
    if (primary.type === "highlight" && primary.target?.includes("terminal")) {
      return "¡Listo! Aquí está la Terminal.";
    }
    if (primary.type === "highlight" && primary.target?.includes("services")) {
      return "¡Listo! Aquí está Services.";
    }
    return es[primary.type] || "¡Listo! Mira lo que abrí.";
  }
  if (switched?.board && nav.some((a) => a.type === "open_terminal")) {
    return `Done! Opened ${switched.board}'s Terminal.`;
  }
  if (switched?.board && nav.some((a) => a.type === "open_browser" || a.type === "open_services")) {
    return `Done! Opened ${switched.board}'s Services.`;
  }
  if (switched?.board && nav.some((a) => a.type === "open_health")) {
    return `Done! Opened ${switched.board}'s Health.`;
  }
  if (switched?.board && nav.some((a) => a.type === "open_files")) {
    return `Done! Opened ${switched.board}'s Files.`;
  }
  if (switched?.board) return `Got it — switched to ${switched.board}.`;
  const en: Record<string, string> = {
    open_chat: "Sure! Here's Chat.",
    new_chat: "Done! Fresh chat for you.",
    open_machine: "Sure! Here's Machine.",
    open_health: "Done! Here's Health.",
    open_terminal: "Done! Here's the Terminal.",
    open_files: "Sure! Here's Files.",
    open_browser: "Done! Here's Services.",
    open_services: "Done! Here's Services.",
    open_panel: "Got it — opened the panel.",
    open_board: "Sure! Here's the Board panel.",
    open_plan: "Done! Here's your Plan.",
    open_nav: "Sure! Opened the sidebar.",
    highlight: "Here — I'm pointing at it.",
  };
  if (primary.type === "highlight" && primary.target?.includes("terminal")) {
    return "Done! Here's the Terminal.";
  }
  return en[primary.type] || "Done! Take a look.";
}

function normAsk(text: string): string {
  return text
    .toLowerCase()
    .replace(/[^\p{L}\p{N}\s]/gu, " ")
    .replace(/\s+/g, " ")
    .trim();
}

function echoesUser(spoken: string, userText: string): boolean {
  const a = normAsk(spoken);
  const b = normAsk(userText);
  if (!a || !b) return !a;
  if (a === b) return true;
  if (a.length <= b.length + 8 && (b.includes(a) || a.includes(b))) return true;
  // "Where is terminal?" / "Where is the terminal"
  if (/^(where is|dónde está|donde esta|abre|open)\b/.test(b) && a.length < 48 && !/[.!]/.test(spoken)) {
    if (/\b(terminal|health|files|archivos|chat|board|plan)\b/.test(a) && a.split(" ").length <= 6) return true;
  }
  return false;
}

export function isFleetCountQuestion(userText: string): boolean {
  const t = userText.trim().toLowerCase();
  if (!t) return false;
  const aboutFleet = /\b(fleet|flota|devices?|boards?|m[aá]quinas?|jetsons?)\b/.test(t);
  if (!aboutFleet) return false;
  if (/\b(terminal|shell|archivo|files|temp|temperatura|ram|gpu)\b/.test(t)) return false;
  return (
    /\b(cu[aá]nt[oa]s?|how many|number of|cu[aá]l(es)?|quién|quien|who|list|lista|conectad|online|paired)\b/.test(t) ||
    /\b(hay|tiene|tengo)\b.*\b(device|board|m[aá]quina)/.test(t)
  );
}

function mentionedFleetBoard(
  userText: string,
  fleet: Array<{ name: string; status: string }>,
  selectedName: string
): string | null {
  const t = userText.toLowerCase();
  let hit: string | null = null;
  for (const d of fleet) {
    const name = d.name.trim();
    if (!name) continue;
    const re = new RegExp(`\\b${name.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}\\b`, "i");
    if (!re.test(t)) continue;
    if (name.toLowerCase() === selectedName.trim().toLowerCase()) continue;
    hit = name;
  }
  return hit;
}

/** A question about what something is or does, not a request to open it. */
function explainsSomething(userText: string): boolean {
  return /\b(what (does|is|are)|how (does|do)|why|explain|qu[eé] (hace|es|son)|para qu[eé]|c[oó]mo funciona|expl[ií]ca)\b/i.test(
    userText
  );
}

export function polishGuideTurn(
  userText: string,
  display: string,
  actions: GuideAction[],
  opts: {
    boardName?: string | null;
    fleet?: Array<{ name: string; status: string }>;
    balance?: {
      cloud_remaining_usd: number;
      cloud_credit_usd: number;
      tavily_credits_remaining: number;
      tavily_credits: number;
    } | null;
    boardEmu?: boolean;
    desk?: { secret_names?: string[]; expert_names?: string[] };
  } = {}
): { text: string; actions: GuideAction[] } {
  let nextActions = actions;
  let nextText = display;
  const boardName = (opts.boardName || "").trim();
  const fleet = opts.fleet || [];
  const bal = opts.balance;
  const secrets = opts.desk?.secret_names || [];
  const experts = opts.desk?.expert_names || [];
  const spanish =
    /[áéíóúñ¿¡]/i.test(userText) ||
    /\b(qu[eé]|cu[aá]l|cu[aá]nt[oa]s?|m[aá]quina|abierta|ahorita|hola|gracias|flota|conectad|crédito|credito|modelo)\b/i.test(
      userText
    );

  if (isSocialTurn(userText)) {
    const reacts = actions.filter((a) => a.type === "react");
    nextActions = reacts.length ? [reacts[reacts.length - 1]] : [{ type: "react", emotion: "happy" }];
    // The model often echoes "Hello Mills" — never show the user's line as Nova's reply.
    if (!nextText.trim() || echoesUser(nextText, userText)) {
      nextText = socialCaption(userText, spanish);
    }
  }

  if (isCurrentBoardQuestion(userText) && boardName) {
    nextActions = [{ type: "react", emotion: "happy" }];
    const mentions = nextText.toLowerCase().includes(boardName.toLowerCase());
    nextText = mentions
      ? nextText
      : spanish
        ? `La board abierta es ${boardName}.`
        : `The open board is ${boardName}.`;
  }

  if (isFleetCountQuestion(userText) && fleet.length) {
    nextActions = [{ type: "react", emotion: "happy" }];
    const online = fleet.filter((d) => d.status === "online");
    const names = fleet.map((d) => d.name).join(", ");
    const hasCount = new RegExp(`\\b${fleet.length}\\b`).test(nextText);
    const hasName = fleet.some((d) => nextText.toLowerCase().includes(d.name.toLowerCase()));
    if (!hasCount || !hasName) {
      nextText = spanish
        ? `Tienes ${fleet.length} board${fleet.length === 1 ? "" : "s"} en el fleet (${online.length} online): ${names}.`
        : `You have ${fleet.length} board${fleet.length === 1 ? "" : "s"} in the fleet (${online.length} online): ${names}.`;
    }
  }

  const asksCredits =
    /\b(cr[eé]dito|credit|balance|cu[aá]nto.*(queda|left|tengo)|how much.*(left|credit)|subscription|plan)\b/i.test(
      userText
    ) && !/\b(pair|emparej)\b/i.test(userText);
  if (asksCredits && bal) {
    nextActions = [
      { type: "react", emotion: "happy" },
      { type: "open_plan" },
      { type: "highlight", target: "panel.plan" },
    ];
    nextText = spanish
      ? `Te quedan $${bal.cloud_remaining_usd.toFixed(2)} de cloud y ${bal.tavily_credits_remaining} créditos de búsqueda.`
      : `You have $${bal.cloud_remaining_usd.toFixed(2)} cloud credit and ${bal.tavily_credits_remaining} search credits left.`;
  }

  const asksModels =
    /\b(modelos?|models?|compatible|cu[aá]les.*(llm|modelo)|which models?|what models?|glimmer|spark|wonder)\b/i.test(
      userText
    ) && !/\b(picker|cambia|change|switch)\b.*\b(model|modelo)\b/i.test(userText);
  if (asksModels) {
    nextActions = [
      { type: "react", emotion: "happy" },
      { type: "open_chat" },
      { type: "highlight", target: "chat.model_picker" },
    ];
    nextText = opts.boardEmu
      ? spanish
        ? "En este board-emu: Spark (fast) y Wonder (heavy), sin Local."
        : "On this board-emu: Spark (fast) and Wonder (heavy), no Local."
      : spanish
        ? "Modelos: Auto, Local (en la placa), Spark (fast) y Wonder (heavy) — elige en el model picker."
        : "Models: Auto, Local (on the board), Spark (fast), and Wonder (heavy) — pick in the model picker.";
  }

  const asksSecretsList =
    /\b(secrets?|secretos?|vault|llavero|api ?keys?)\b/i.test(userText) &&
    /\b(qu[eé]|which|what|list|lista|tengo|have|cu[aá]nt|names?|nombres?)\b/i.test(userText);
  if (asksSecretsList) {
    nextActions = [
      { type: "react", emotion: "happy" },
      { type: "open_board" },
      { type: "highlight", target: "board.secrets" },
    ];
    nextText = secrets.length
      ? spanish
        ? `Secrets (solo nombres): ${secrets.join(", ")}.`
        : `Secret names: ${secrets.join(", ")}.`
      : spanish
        ? "No veo secrets listados ahora — ábrelos en Library → Secrets."
        : "No secret names listed right now — open Library → Secrets.";
  }

  const asksExpertsList =
    /\b(experts?|brains?|cerebros?)\b/i.test(userText) &&
    /\b(qu[eé]|which|what|list|lista|tengo|have|cu[aá]nt|names?|nombres?)\b/i.test(userText);
  if (asksExpertsList) {
    nextActions = [
      { type: "react", emotion: "happy" },
      { type: "open_board" },
      { type: "highlight", target: "board.experts" },
    ];
    nextText = experts.length
      ? spanish
        ? `Experts: ${experts.join(", ")}.`
        : `Experts: ${experts.join(", ")}.`
      : spanish
        ? "No hay experts aún — créalos en Library → Experts."
        : "No experts yet — create them in Library → Experts.";
  }

  const wantsServices = /\b(services?|servicios?|localhost|preview|vite|docker|contenedor(es)?)\b/i.test(
    userText
  );
  const wantsTerm = /\b(terminal|shell|comando)\b/i.test(userText);
  const wantsHealth = /\b(health|temp|temperatura|ram|gpu)\b/i.test(userText);
  const wantsFiles = /\b(files?|archivos?)\b/i.test(userText);
  const wantsMemory = /\b(memor(y|ia)|memories)\b/i.test(userText);
  const wantsSecrets = /\b(secrets?|secretos?|vault|llavero)\b/i.test(userText);
  const wantsExperts = /\b(experts?|brains?|cerebros?)\b/i.test(userText);
  const wantsStatus = /\b(board status|status del board|estado del board)\b/i.test(userText);
  const wantsPair = /\b(pair|emparej|conectar board|connect board)\b/i.test(userText);
  const wantsFleet =
    /\b(fleet|flota)\b/i.test(userText) &&
    /\b(open|abre|abrir|show|muestra|dónde|donde|where|ve a|go to)\b/i.test(userText);
  const wantsMachine = /\b(open machine|abre machine|abrir machine|ve a machine|dónde.*machine|donde.*machine)\b/i.test(
    userText
  );
  const wantsNewChat =
    /\b(new chat|chat nuevo|nuevo chat|start (a )?fresh|empieza (un )?chat)\b/i.test(userText);
  const wantsComposer =
    /\b(composer|escribe(r)? (aquí|aqui)|message (box|field)|caja de (mensaje|texto))\b/i.test(userText);
  const wantsModelPicker =
    /\b(model picker|elige(r)? (el )?modelo|cambia(r)? (el )?modelo|change model|switch model)\b/i.test(userText);
  const wantsPlan =
    /\b(plan|créditos?|creditos?|credits?|subscription|suscripci[oó]n)\b/i.test(userText) &&
    /\b(open|abre|abrir|show|muestra|dónde|donde|where|ve a|go to)\b/i.test(userText);
  const wantsBoardPanel =
    /\b(panel board|board panel)\b/i.test(userText) ||
    (/\b(board)\b/i.test(userText) &&
      /\b(open|abre|abrir|show|muestra|dónde|donde|where)\b/i.test(userText) &&
      !wantsMemory &&
      !wantsSecrets &&
      !wantsExperts &&
      !wantsStatus &&
      !mentionedFleetBoard(userText, fleet, boardName));
  const wantsChatView =
    /\b(open chat|abre (el )?chat|abrir chat|ve al chat|go to chat|dónde.*chat|donde.*chat)\b/i.test(userText) &&
    !wantsNewChat;

  // Same-board UI map — Nova can open any desk surface without waiting on the model.
  if (!mentionedFleetBoard(userText, fleet, boardName)) {
    type NavHit = { actions: GuideAction[]; textEs: string; textEn: string };
    const hit: NavHit | null = wantsNewChat
      ? {
          actions: [
            { type: "react", emotion: "excited" },
            { type: "open_nav" },
            { type: "new_chat" },
            { type: "highlight", target: "nav.new_chat" },
          ],
          textEs: "¡Listo! Chat nuevo para ti.",
          textEn: "Done! Fresh chat for you.",
        }
      : wantsServices
        ? {
            actions: [
              { type: "react", emotion: "happy" },
              { type: "open_browser" },
              { type: "highlight", target: "machine.services" },
            ],
            textEs: "¡Listo! Aquí está Services.",
            textEn: "Done! Here's Services.",
          }
        : wantsTerm && !/\b(disco|disk|df\b|almacen|espacio libre|free space)\b/i.test(userText)
          ? {
              actions: [
                { type: "react", emotion: "happy" },
                { type: "open_terminal" },
                { type: "highlight", target: "machine.terminal" },
              ],
              textEs: "¡Listo! Aquí está la Terminal.",
              textEn: "Done! Here's the Terminal.",
            }
          : wantsHealth
            ? {
                actions: [
                  { type: "react", emotion: "happy" },
                  { type: "open_health" },
                  { type: "highlight", target: "machine.health" },
                ],
                textEs: "¡Claro! Aquí está Health.",
                textEn: "Sure! Here's Health.",
              }
            : wantsFiles
              ? {
                  actions: [
                    { type: "react", emotion: "happy" },
                    { type: "open_files" },
                    { type: "highlight", target: "machine.files" },
                  ],
                  textEs: "¡Claro! Aquí están los Files.",
                  textEn: "Sure! Here's Files.",
                }
              : wantsMemory
                ? {
                    actions: [
                      { type: "react", emotion: "happy" },
                      { type: "open_board" },
                      { type: "highlight", target: "board.memory" },
                    ],
                    textEs: "¡Listo! Aquí está Memory.",
                    textEn: "Done! Here's Memory.",
                  }
                : wantsSecrets && !asksSecretsList
                  ? {
                      actions: [
                        { type: "react", emotion: "happy" },
                        { type: "open_board" },
                        { type: "highlight", target: "board.secrets" },
                      ],
                      textEs: "¡Claro! Aquí están los Secrets.",
                      textEn: "Sure! Here's Secrets.",
                    }
                  : wantsExperts && !asksExpertsList
                    ? {
                        actions: [
                          { type: "react", emotion: "happy" },
                          { type: "open_board" },
                          { type: "highlight", target: "board.experts" },
                        ],
                        textEs: "¡Listo! Aquí están los Experts.",
                        textEn: "Done! Here's Experts.",
                      }
                    : wantsStatus
                      ? {
                          actions: [
                            { type: "react", emotion: "happy" },
                            { type: "open_board" },
                            { type: "highlight", target: "board.status" },
                          ],
                          textEs: "¡Claro! Aquí está Status.",
                          textEn: "Sure! Here's Status.",
                        }
                      : wantsPair
                        ? {
                            actions: [
                              { type: "react", emotion: "happy" },
                              { type: "open_nav" },
                              { type: "highlight", target: "nav.pair" },
                            ],
                            textEs: "¡Listo! Aquí está Pair.",
                            textEn: "Done! Here's Pair.",
                          }
                        : wantsFleet
                          ? {
                              actions: [
                                { type: "react", emotion: "happy" },
                                { type: "open_nav" },
                                { type: "highlight", target: "nav.fleet" },
                              ],
                              textEs: "¡Claro! Aquí está tu flota.",
                              textEn: "Sure! Here's your fleet.",
                            }
                          : wantsMachine
                            ? {
                                actions: [
                                  { type: "react", emotion: "happy" },
                                  { type: "open_machine" },
                                  { type: "highlight", target: "nav.open_machine" },
                                ],
                                textEs: "¡Listo! Aquí está Machine.",
                                textEn: "Done! Here's Machine.",
                              }
                            : wantsModelPicker
                              ? {
                                  actions: [
                                    { type: "react", emotion: "happy" },
                                    { type: "open_chat" },
                                    { type: "highlight", target: "chat.model_picker" },
                                  ],
                                  textEs: "¡Claro! Aquí eliges el modelo.",
                                  textEn: "Sure! Here's the model picker.",
                                }
                              : wantsComposer
                                ? {
                                    actions: [
                                      { type: "react", emotion: "happy" },
                                      { type: "open_chat" },
                                      { type: "highlight", target: "chat.composer" },
                                    ],
                                    textEs: "¡Listo! Aquí escribes al agente.",
                                    textEn: "Done! Here's the composer.",
                                  }
                                : wantsPlan
                                  ? {
                                      actions: [
                                        { type: "react", emotion: "happy" },
                                        { type: "open_plan" },
                                        { type: "highlight", target: "panel.plan" },
                                      ],
                                      textEs: "¡Claro! Aquí está Plan.",
                                      textEn: "Sure! Here's Plan.",
                                    }
                                  : wantsBoardPanel
                                    ? {
                                        actions: [
                                          { type: "react", emotion: "happy" },
                                          { type: "open_board" },
                                          { type: "highlight", target: "panel.board" },
                                        ],
                                        textEs: "¡Listo! Aquí está el panel Board.",
                                        textEn: "Done! Here's the Board panel.",
                                      }
                                    : wantsChatView
                                      ? {
                                          actions: [
                                            { type: "react", emotion: "happy" },
                                            { type: "open_chat" },
                                            { type: "highlight", target: "panel.chat" },
                                          ],
                                          textEs: "¡Claro! Aquí está el Chat.",
                                          textEn: "Sure! Here's Chat.",
                                        }
                                      : null;
    if (hit) {
      nextActions = hit.actions;
      // "What does memory do?" wants Muse's explanation; only keep the canned
      // "Here's Memory." line when the turn is plain navigation.
      const keepAnswer = explainsSomething(userText) && display.trim() && !echoesUser(display, userText);
      nextText = keepAnswer ? display : spanish ? hit.textEs : hit.textEn;
    }
  }

  // "Open Natasha Services" / "abre Aurora health" → switch board then open the screen.
  const other = mentionedFleetBoard(userText, fleet, boardName);
  if (other) {
    const wantsSwitch =
      wantsTerm ||
      wantsHealth ||
      wantsFiles ||
      wantsServices ||
      /\b(open|abre|abrir|switch|cambia|cambiar|ve a|go to|muéstrame|muestrame|show)\b/i.test(userText);
    if (wantsSwitch) {
      const withoutSelect = nextActions.filter((a) => a.type !== "select_board");
      const screen = wantsServices
        ? ({ type: "open_browser" } as GuideAction)
        : wantsHealth
          ? ({ type: "open_health" } as GuideAction)
          : wantsFiles
            ? ({ type: "open_files" } as GuideAction)
            : ({ type: "open_terminal" } as GuideAction);
      const hl =
        screen.type === "open_browser"
          ? "machine.services"
          : screen.type === "open_health"
            ? "machine.health"
            : screen.type === "open_files"
              ? "machine.files"
              : "machine.terminal";
      nextActions = [
        { type: "select_board", board: other },
        ...withoutSelect.filter((a) => a.type === "react"),
        screen,
        { type: "highlight", target: hl },
      ];
      nextText = spanish
        ? wantsServices
          ? `¡Listo! Abrí Services de ${other}.`
          : wantsHealth
            ? `¡Listo! Abrí Health de ${other}.`
            : wantsFiles
              ? `¡Claro! Abrí Files de ${other}.`
              : `¡Listo! Abrí la Terminal de ${other}.`
        : wantsServices
          ? `Done! Opened ${other}'s Services.`
          : wantsHealth
            ? `Done! Opened ${other}'s Health.`
            : wantsFiles
              ? `Sure! Opened ${other}'s Files.`
              : `Done! Opened ${other}'s Terminal.`;
    }
  }

  const wantsDisk = /\b(disco|disk|df\b|almacen|espacio libre|free space)\b/i.test(userText);
  const openedTerm = nextActions.some((a) => a.type === "open_terminal");
  if (wantsDisk && openedTerm && !/\bdf\b/i.test(nextText) && !other) {
    nextText = `${nextText.replace(/[.!…]*\s*$/, "")} — escribe: df -h`;
  }

  const refuses =
    /\b(borra|borrar|elimina|eliminar|delete|wipe|rm\s+-rf|format)\b/i.test(userText) &&
    /\b(por m[ií]|for me|hazlo|do it|puedes)\b/i.test(userText);
  if (refuses) {
    nextActions = nextActions.filter((a) => a.type === "react" || a.type === "open_terminal" || a.type === "highlight");
    const withoutReact = nextActions.filter((a) => a.type !== "react");
    nextActions = [...withoutReact, { type: "react", emotion: "apologetic" }];
  }

  if (!nextActions.some((a) => a.type === "react")) {
    nextActions = [...nextActions, { type: "react", emotion: "happy" }];
  }

  const hasNav = nextActions.some((a) => a.type !== "react");
  if (hasNav && (!nextText.trim() || echoesUser(nextText, userText))) {
    nextText = captionFromActions(nextActions, spanish);
  }
  // Where-is / open requests must always speak — never silent nav.
  if (hasNav && !nextText.trim()) {
    nextText = captionFromActions(nextActions, spanish);
  }

  return { text: nextText.trim(), actions: nextActions };
}
