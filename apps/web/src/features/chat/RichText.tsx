import type { ReactNode } from "react";

/**
 * Just enough Markdown for a chat transcript: fenced code blocks, inline code
 * and bold. It builds React nodes, never HTML, so model output cannot inject
 * markup. Everything else stays plain text (the bubble keeps line breaks).
 */
export function RichText({ text }: { text: string }) {
  const parts: ReactNode[] = [];
  const fence = /```([\w+-]*)\n?([\s\S]*?)(?:```|$)/g;
  let last = 0;
  let match: RegExpExecArray | null;
  let key = 0;

  while ((match = fence.exec(text)) !== null) {
    if (match.index > last) parts.push(<Inline key={key++} text={text.slice(last, match.index)} />);
    const lang = match[1];
    const code = match[2].replace(/\n$/, "");
    // A patch shows as its own approval card with the diff; skip the raw block
    // but keep a line break, so the sentences around it stay apart.
    if (lang === "patch") {
      parts.push(<br key={key++} />);
      last = fence.lastIndex;
      continue;
    }
    parts.push(
      <pre key={key++} className="md-rich__code" data-lang={lang || undefined}>
        <code>{code}</code>
      </pre>,
    );
    last = fence.lastIndex;
    if (match[0].length === 0) break;
  }
  if (last < text.length) parts.push(<Inline key={key++} text={text.slice(last)} />);
  return <>{parts}</>;
}

function Inline({ text }: { text: string }) {
  // Trim the blank line a fence leaves behind so blocks do not float in extra space.
  const clean = text.replace(/^\n+|\n+$/g, (edge) => (edge.length > 1 ? "\n" : ""));
  const nodes: ReactNode[] = [];
  const token = /`([^`\n]+)`|\*\*([^*\n]+)\*\*/g;
  let last = 0;
  let match: RegExpExecArray | null;
  let key = 0;
  while ((match = token.exec(clean)) !== null) {
    if (match.index > last) nodes.push(clean.slice(last, match.index));
    if (match[1] !== undefined) nodes.push(<code key={key++} className="md-rich__inline">{match[1]}</code>);
    else nodes.push(<strong key={key++}>{match[2]}</strong>);
    last = token.lastIndex;
  }
  if (last < clean.length) nodes.push(clean.slice(last));
  return <span>{nodes}</span>;
}
