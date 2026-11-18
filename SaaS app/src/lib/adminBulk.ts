// Shared pieces of the Admin "Save all" pattern. Pure, so it can be tested without a browser.

/** The result of running one existing per-row action: Next's redirect carries the banner text in its URL. */
export type RowResult = { ok: boolean; message: string };

/** Reads the notice or error out of the redirect an action ends with. Returns null when this is not a redirect. */
export function resultFromRedirect(e: unknown): RowResult | null {
  const digest = (e as { digest?: unknown } | null)?.digest;
  if (typeof digest !== "string" || !digest.startsWith("NEXT_REDIRECT;")) return null;
  const url = digest.split(";")[2] ?? "";
  const q = url.includes("?") ? new URLSearchParams(url.slice(url.indexOf("?") + 1)) : new URLSearchParams();
  const error = q.get("error");
  if (error) return { ok: false, message: error };
  return { ok: true, message: q.get("notice") ?? "Saved." };
}

export type BulkRow = { kind: string; fields: [string, string][] };
export type BulkOutcome = { saved: number; failed: { index: number; message: string }[] };

export const MAX_BULK_ROWS = 200;

export function formDataFrom(fields: [string, string][]): FormData {
  const f = new FormData();
  for (const [k, v] of fields) if (typeof k === "string" && typeof v === "string") f.append(k, v);
  return f;
}

export function savedMessage(o: BulkOutcome): string {
  const s = `${o.saved} ${o.saved === 1 ? "change" : "changes"} saved`;
  return o.failed.length ? `${s}. ${o.failed.length} not saved: ${[...new Set(o.failed.map((f) => f.message))].slice(0, 3).join("; ")}` : `${s}.`;
}
