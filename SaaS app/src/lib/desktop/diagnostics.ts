// Recorder diagnostics: short slugs and error codes only. No free text, no transcripts, no patient values, no bodies.
export const DIAG_RETENTION_DAYS = 90;
const SLUG = /^[a-z0-9][a-z0-9_.-]{0,47}$/i;
const VERSION = /^\d{1,4}\.\d{1,4}\.\d{1,5}$/;
const OS = /^[A-Za-z0-9 ._()-]{1,40}$/;

export type Diagnostic = { appVersion: string; os: string; event: string; code: string };

/** Returns a clean record or null. Anything that is not a short slug is refused, which keeps free text out. */
export function parseDiagnostic(body: Record<string, unknown>): Diagnostic | null {
  const s = (k: string) => (typeof body[k] === "string" ? (body[k] as string) : "");
  const d = { appVersion: s("appVersion"), os: s("os"), event: s("event"), code: s("code") };
  if (!VERSION.test(d.appVersion) || !OS.test(d.os) || !SLUG.test(d.event) || !SLUG.test(d.code)) return null;
  return d;
}
