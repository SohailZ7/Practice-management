// What a Feedback list row shows on its one line: the title, then (when the title is short) the start of the description so the submitter recognizes the item.
// The row is still one line (CSS ellipsis); the full text is in the hover title and in the opened item.
const SHORT_TITLE = 70;
const SNIPPET_MAX = 160;

export function rowSnippet(title: string, description: string): string {
  if (title.trim().length >= SHORT_TITLE) return "";
  const flat = description.replace(/^Submitted by:[^\n]*\n*/i, "").replace(/\s+/g, " ").trim();
  if (!flat) return "";
  return flat.length > SNIPPET_MAX ? `${flat.slice(0, SNIPPET_MAX - 1).trimEnd()}…` : flat;
}

/** Hover text for a row: the whole title and the description. */
export function rowHover(title: string, description: string): string {
  const d = description.replace(/\s+/g, " ").trim();
  return d ? `${title} — ${d}`.slice(0, 600) : title;
}

/** "Live in production, Web 1.NN" for a Released item with a stored release number; null otherwise. */
export function liveBadge(status: string, release: number | null): string | null {
  return status === "released" && typeof release === "number" && release > 0 ? `Live in production, Web 1.${release}` : null;
}
