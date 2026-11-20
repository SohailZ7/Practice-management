// Suggests which visit an unlinked recording belongs to: same day (practice time zone), the recording's own provider, closest start time.
// Pure matching, no database. The caller sends the suggestion to the recorder, which links with one tap through the existing link call.
import { PRACTICE_TIMEZONE } from "../dates";
import { timeColumns } from "../unify/plan";

export type SuggestVisit = { id: string; visitDate: string; apptTime: string; startTime: string | null; providerName: string; status: string; transcript: string; initials: string };
export type Suggestion = { visitId: string; initials: string; visitDate: string; apptTime: string; providerName: string; confidence: "high" | "medium" | "low"; reason: string[] };

const norm = (s: string) => s.toLowerCase().replace(/\b(dr|md|do|np|pa|pmhnp|lcsw|phd)\b\.?/g, "").replace(/[^a-z\s]/g, " ").replace(/\s+/g, " ").trim();

/** Same provider when one name contains the other's words (last name at least), ignoring titles and punctuation. */
export function sameProvider(visitProvider: string, userName: string): boolean {
  const a = norm(visitProvider), b = norm(userName);
  if (!a || !b) return false;
  if (a === b || a.includes(b) || b.includes(a)) return true;
  const last = (s: string) => s.split(" ").filter(Boolean).pop() ?? "";
  return last(a).length > 2 && last(a) === last(b);
}

/** The practice-local date and minutes since midnight of an instant. */
export function localParts(at: Date, timeZone = PRACTICE_TIMEZONE): { date: string; minutes: number } {
  const p = Object.fromEntries(new Intl.DateTimeFormat("en-CA", { timeZone, year: "numeric", month: "2-digit", day: "2-digit", hour: "2-digit", minute: "2-digit", hourCycle: "h23" }).formatToParts(at).map((x) => [x.type, x.value]));
  return { date: `${p.year}-${p.month}-${p.day}`, minutes: Number(p.hour) * 60 + Number(p.minute) };
}

const toMin = (hhmm: string | null) => (hhmm && /^\d{2}:\d{2}$/.test(hhmm) ? Number(hhmm.slice(0, 2)) * 60 + Number(hhmm.slice(3)) : null);
export const startMinutes = (v: Pick<SuggestVisit, "startTime" | "apptTime">) => toMin(v.startTime ?? timeColumns(v.apptTime).startTime);

/**
 * Picks the best visit for a recording made at `recordedAt` by a user called `userName`. Needs the same day and the same provider;
 * time decides among them (high within 45 minutes, medium within 2 hours, low otherwise). Cancelled and no-show visits are skipped.
 * Returns null when nothing matches both day and provider.
 */
export function suggestVisit(rec: { recordedAt: Date }, userName: string, visits: SuggestVisit[]): Suggestion | null {
  const when = localParts(rec.recordedAt);
  const pool = visits.filter((v) => v.visitDate === when.date && v.status !== "cancelled" && v.status !== "no_show" && sameProvider(v.providerName, userName));
  if (pool.length === 0) return null;
  const scored = pool
    .map((v) => { const m = startMinutes(v); return { v, diff: m === null ? Infinity : Math.abs(m - when.minutes), empty: !v.transcript.trim() }; })
    .sort((a, b) => a.diff - b.diff || Number(b.empty) - Number(a.empty) || (a.v.id < b.v.id ? -1 : 1));
  const best = scored[0];
  const tied = scored.filter((s) => s.diff === best.diff).length > 1;
  const confidence = best.diff <= 45 && !tied ? "high" : best.diff <= 120 ? "medium" : "low";
  const reason = ["same day", "same provider"];
  if (best.diff !== Infinity) reason.push(best.diff <= 45 ? "time within 45 min" : best.diff <= 120 ? "time within 2 h" : "time differs");
  if (best.empty) reason.push("no transcript yet");
  if (tied) reason.push("another visit at the same time");
  return { visitId: best.v.id, initials: best.v.initials, visitDate: best.v.visitDate, apptTime: best.v.apptTime, providerName: best.v.providerName, confidence, reason };
}
