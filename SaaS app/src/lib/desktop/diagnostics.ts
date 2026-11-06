// Recorder diagnostics (contract: desktop-update-diagnostics-contract.md). Strict allowlist, no free text that can hold PHI.
export const DIAG_RETENTION_DAYS = 30;
export const DIAG_MAX_BYTES = 16 * 1024;
export const DIAG_MAX_PER_HOUR = 20;
const MAX_EVENTS = 50;
const KINDS = ["api", "network", "js", "update", "recording"] as const;
const TOP_KEYS = ["appVersion", "commit", "os", "arch", "environment", "manual", "events"];
const EVENT_KEYS = ["ts", "kind", "code", "route", "detail"];

const SHORT = /^[A-Za-z0-9 ._()\/:+-]{1,60}$/;
const VERSION = /^\d{1,4}\.\d{1,4}\.\d{1,5}$/;
const ENVS = ["production", "staging", "development", "prod", "stage", "dev", "localhost"];

export type DiagEvent = { ts: string; kind: (typeof KINDS)[number]; code?: string; route?: string; detail?: string };
export type Diagnostic = { appVersion: string; commit: string; os: string; arch: string; environment: string; manual: boolean; events: DiagEvent[] };

/** Server-side scrub of a free-text field: anything that looks like an email, URL or long number is dropped entirely. */
export function scrub(v: string, max = 120): string {
  if (/@|https?:|www\.|\d{4,}/i.test(v)) return "";
  return v.slice(0, max);
}

const route = (v: string) => v.replace(/\?.*$/, "").replace(/\/[0-9a-f-]{8,}/gi, "/:id").slice(0, 80);

/** A clean record, or null if the body has an unknown key, a bad type or a bad value. */
export function parseDiagnostic(body: Record<string, unknown>): Diagnostic | null {
  if (Object.keys(body).some((k) => !TOP_KEYS.includes(k))) return null;
  const s = (k: string) => (typeof body[k] === "string" ? (body[k] as string) : "");
  const appVersion = s("appVersion");
  const commit = s("commit");
  const os = s("os");
  const arch = s("arch");
  const environment = s("environment");
  if (!VERSION.test(appVersion) || !/^[0-9a-f]{0,40}$/i.test(commit) || !SHORTISH(os) || !SHORTISH(arch) || !ENVS.includes(environment.toLowerCase())) return null;
  if (typeof body.manual !== "boolean" || !Array.isArray(body.events) || body.events.length > MAX_EVENTS) return null;
  const events: DiagEvent[] = [];
  for (const e of body.events) {
    if (!e || typeof e !== "object" || Array.isArray(e)) return null;
    const r = e as Record<string, unknown>;
    if (Object.keys(r).some((k) => !EVENT_KEYS.includes(k))) return null;
    if (typeof r.ts !== "string" || Number.isNaN(Date.parse(r.ts))) return null;
    if (typeof r.kind !== "string" || !(KINDS as readonly string[]).includes(r.kind)) return null;
    for (const k of ["code", "route", "detail"]) if (r[k] !== undefined && typeof r[k] !== "string") return null;
    const code = r.code as string | undefined;
    if (code !== undefined && !SHORT.test(code)) return null;
    events.push({
      ts: new Date(r.ts).toISOString(),
      kind: r.kind as DiagEvent["kind"],
      ...(code ? { code } : {}),
      ...(typeof r.route === "string" && r.route ? { route: scrub(route(r.route), 80) } : {}),
      ...(typeof r.detail === "string" && scrub(r.detail) ? { detail: scrub(r.detail) } : {}),
    });
  }
  return { appVersion, commit: commit.toLowerCase(), os, arch, environment: environment.toLowerCase(), manual: body.manual, events };
}
function SHORTISH(v: string) {
  return SHORT.test(v);
}
