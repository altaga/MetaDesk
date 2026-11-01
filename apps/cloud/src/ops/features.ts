/** Cheap, privacy-safe signals derived from text — never store the text itself for users. */

export function lenBucket(text: string): string {
  const n = text.trim().length;
  if (n <= 20) return "0-20";
  if (n <= 80) return "21-80";
  if (n <= 200) return "81-200";
  if (n <= 500) return "201-500";
  return "500+";
}

export function guessLang(text: string): string {
  const t = text.toLowerCase();
  if (/[áéíóúñ¿¡]/.test(t) || /\b(hola|gracias|abre|terminal|por favor|ayúdame|ayuda)\b/.test(t)) return "es";
  if (/\b(the|please|open|thanks|hello|help)\b/.test(t)) return "en";
  return "und";
}

export function guideFeatures(input: string, output: string, actions: Array<{ type: string; target?: string; emotion?: string }>) {
  return {
    msg_len: lenBucket(input),
    reply_len: lenBucket(output),
    lang: guessLang(input),
    has_fence: /```guide/i.test(output),
    action_types: actions.map((a) => a.type),
    emotions: actions.filter((a) => a.type === "react" && a.emotion).map((a) => a.emotion as string),
    highlight_targets: actions.filter((a) => a.type === "highlight" && a.target).map((a) => a.target as string),
  };
}

export function chatFeatures(input: string, output: string, extra: Record<string, unknown> = {}) {
  return {
    msg_len: lenBucket(input),
    reply_len: lenBucket(output),
    lang: guessLang(input),
    has_run_fence: /```run/i.test(output),
    ...extra,
  };
}
