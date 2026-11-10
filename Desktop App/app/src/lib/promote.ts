import type { NewVisit, Visit } from "./api";

/**
 * Moves one visit and its transcript from Staging to Production. The recorder does the move itself with the two
 * sign-ins it already holds: the servers never talk to each other. Safe to repeat: a visit already in Production is
 * found again instead of being created twice, and a visit that is there without its transcript gets the transcript.
 */
export type PromoteDeps = {
  readTranscript: () => Promise<string>;
  listProduction: (date: string) => Promise<Visit[]>;
  createProduction: (date: string, v: NewVisit) => Promise<{ id: string }>;
  pushProduction: (visitId: string, transcript: string) => Promise<unknown>;
};

export type PromoteResult = { ok: true; productionId: string; already: boolean } | { ok: false; message: string };

const clock = (t?: string) => (t ?? "").replace(/\s+/g, "").toLowerCase();
const initialsOf = (v: Visit) => v.realInitials ?? v.initials;

/** The same visit in the other environment: same day (the list is for one day), initials, time and program. */
export const sameVisit = (a: Visit, b: Visit) =>
  initialsOf(a) === initialsOf(b) && clock(a.apptTime) === clock(b.apptTime) && (a.program ?? "") === (b.program ?? "");

export function promoteBlocker(v: Visit): string {
  if (!v.fullName) return "Full names are off for your account (Production needs the name).";
  if (!v.hasTranscript) return "Record the visit first: there is no transcript to promote.";
  return "";
}

export async function promoteVisit(visit: Visit, date: string, d: PromoteDeps): Promise<PromoteResult> {
  const blocker = promoteBlocker(visit);
  if (blocker) return { ok: false, message: blocker };
  let text: string;
  try { text = (await d.readTranscript()).trim(); } catch { return { ok: false, message: "Could not read the transcript from Staging. Nothing was changed." }; }
  if (!text) return { ok: false, message: "The transcript on Staging is empty. Nothing was changed." };

  let existing: Visit | undefined;
  try { existing = (await d.listProduction(date)).find((p) => sameVisit(visit, p)); }
  catch (e) { return { ok: false, message: `Could not reach Production. Nothing was changed. ${e instanceof Error ? e.message : ""}`.trim() }; }

  if (existing?.hasTranscript) return { ok: true, productionId: existing.id, already: true };

  let id = existing?.id;
  if (!id) {
    try {
      id = (await d.createProduction(date, {
        patient: visit.fullName!, apptTime: visit.apptTime || undefined, program: visit.program || undefined,
        appointmentType: visit.appointmentType || undefined, providerName: visit.providerName || undefined,
      })).id;
    } catch (e) {
      return { ok: false, message: `Production did not accept the visit, so nothing was moved. ${e instanceof Error ? e.message : ""}`.trim() };
    }
  }
  try { await d.pushProduction(id, text); }
  catch (e) {
    return { ok: false, message: `The visit is in Production but its transcript did not upload. Press Promote again to finish. ${e instanceof Error ? e.message : ""}`.trim() };
  }
  return { ok: true, productionId: id, already: false };
}

const KEY = "practice.promoted";
const read = (): Record<string, string> => { try { return JSON.parse(localStorage.getItem(KEY) ?? "{}") as Record<string, string>; } catch { return {}; } };
export const isPromoted = (stagingVisitId: string) => !!read()[stagingVisitId];
export const markPromoted = (stagingVisitId: string, productionId: string) => {
  try { localStorage.setItem(KEY, JSON.stringify({ ...read(), [stagingVisitId]: productionId })); } catch { /* the Production check still stops a duplicate */ }
};
