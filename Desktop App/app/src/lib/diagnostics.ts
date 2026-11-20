/**
 * Diagnostics for remote support. Records WHAT went wrong (error kind, HTTP status, the server's short error code, a
 * route with ids removed, a timestamp), never WHO or WHAT was said: no patient names, no transcript text, no audio, no
 * URLs with identifiers. Free text exists only for errors thrown by this app's own code, and is scrubbed and cut short.
 */
export type DiagEvent = { ts: string; kind: "api" | "network" | "js" | "update" | "recording"; code?: string; route?: string; detail?: string };

const MAX_EVENTS = 50;
const events: DiagEvent[] = [];
let sender: (() => void) | null = null;
let autoTimer: ReturnType<typeof setTimeout> | null = null;
let lastAuto = 0;

/** "/notes/visits/ckx12abc34def/transcript?date=2026-11-05" becomes "/notes/visits/:id/transcript". */
export function routeTemplate(path: string): string {
  const bare = path.split("?")[0].replace(/^\/api\/desktop\/v1/, "");
  return bare.split("/").map((seg) => (seg && (/\d/.test(seg) || seg.length >= 12) ? ":id" : seg)).join("/");
}

/** Cuts anything that could carry an identifier out of a short message. */
export function scrub(text: string): string {
  return text
    .replace(/[\w.+-]+@[\w-]+\.[\w.-]+/g, "[email]")
    .replace(/https?:\/\/\S+/g, "[url]")
    .replace(/\d{3,}/g, "#")
    .replace(/\s+/g, " ")
    .slice(0, 120);
}

/** Only short lower-case codes from the server (like "bad_provider") are kept; anything else is dropped. */
export function safeCode(code: string | null | undefined): string | undefined {
  return code && /^[a-z0-9_]{2,40}$/.test(code) ? code : undefined;
}

const sig = (e: Pick<DiagEvent, "kind" | "code" | "route">) => `${e.kind}|${e.code ?? ""}|${e.route ?? ""}`;
const repeats = new Map<string, number>();
let reportedSigs = new Set<string>();
let lastReportAt = 0;

/** An identical event (same kind, code and route) is not added again: the earlier one says "repeated N times". A retry
 *  loop therefore cannot fill the list or trigger a report of its own. */
export function record(e: Omit<DiagEvent, "ts">, auto = true): void {
  const key = sig(e);
  let same: DiagEvent | undefined;
  for (let i = events.length - 1; i >= 0 && !same; i--) if (sig(events[i]) === key) same = events[i];
  if (same) {
    const n = (repeats.get(key) ?? 1) + 1;
    repeats.set(key, n);
    same.detail = `repeated ${n} times`;
    return;
  }
  repeats.set(key, 1);
  events.push({ ts: new Date().toISOString(), ...e, ...(e.detail ? { detail: scrub(e.detail) } : {}) });
  if (events.length > MAX_EVENTS) { const gone = events.shift(); if (gone) repeats.delete(sig(gone)); }
  if (auto) scheduleAuto();
}

/** True when an automatic report is worthwhile: an event kind not yet reported, or 6 hours since the last report. */
export function shouldAutoReport(now: number): boolean {
  if (events.length === 0) return false;
  return events.some((e) => !reportedSigs.has(sig(e))) || now - lastReportAt >= 6 * 3_600_000;
}
export function markReported(now: number): void { reportedSigs = new Set(events.map(sig)); lastReportAt = now; }

export const recentEvents = (): DiagEvent[] => events.slice();
export const clearEvents = (): void => { events.length = 0; repeats.clear(); reportedSigs = new Set(); lastReportAt = 0; };

/** The app registers how to send; errors then trigger one report, at most one every 5 minutes. */
export function setSender(fn: (() => void) | null): void { sender = fn; }

function scheduleAuto(): void {
  if (!sender || autoTimer) return;
  const wait = Math.max(15_000, lastAuto + 5 * 60_000 - Date.now());
  autoTimer = setTimeout(() => { autoTimer = null; lastAuto = Date.now(); if (shouldAutoReport(lastAuto)) { markReported(lastAuto); sender?.(); } }, wait);
}

/** Uncaught errors in the page. Installed once. */
let installed = false;
export function installGlobalHandlers(): void {
  if (installed || typeof window === "undefined") return;
  installed = true;
  window.addEventListener("error", (e) => record({ kind: "js", code: e.error?.name ?? "Error", detail: e.message }));
  window.addEventListener("unhandledrejection", (e) => {
    const r = e.reason as { name?: string; message?: string } | undefined;
    record({ kind: "js", code: r?.name ?? "Rejection", detail: typeof r?.message === "string" ? r.message : "" });
  });
}
