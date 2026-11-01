/** Pull the Angle and Method out of an expert's markdown profile. */

function readSection(markdown: string | undefined, heading: string): string {
  if (!markdown) return "";
  const pattern = new RegExp(`## ${heading}\\s+([\\s\\S]*?)(?:\\n## |$)`);
  const found = markdown.match(pattern);
  return (found?.[1] ?? "").trim();
}

/** The expert's angle, falling back to the stored description. */
export function profileAngle(markdown: string | undefined, fallback = ""): string {
  return readSection(markdown, "Angle") || fallback;
}

/** How the expert would do the work. */
export function profileMethod(markdown: string | undefined): string {
  return readSection(markdown, "Method");
}
