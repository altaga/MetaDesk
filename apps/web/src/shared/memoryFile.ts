/** Read the filename and the Fact out of a shared memory markdown file. */

const FACT = /## Fact\s+([\s\S]*?)(?:\n## |$)/;
const MAX_PREVIEW = 280;

/** The slug-based filename the board would store this memory under. */
export function memoryFileName(title: string): string {
  const slug = title
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-|-$/g, "");
  return `${slug || "memory"}.md`;
}

/** The Fact body, trimmed to a short preview for the list. */
export function memoryFact(markdown?: string): string {
  const source = markdown ?? "";
  const found = source.match(FACT);
  const fact = (found?.[1] ?? source).trim();
  return fact.length > MAX_PREVIEW ? `${fact.slice(0, MAX_PREVIEW - 3)}…` : fact;
}
