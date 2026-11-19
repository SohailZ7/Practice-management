// Unification, Release A: decides what the backfill would do. PURE (no database): the scripts load rows, this decides,
// the scripts apply. Rules (docs/release-a-runbook.md):
//  - an entry that mirrors an existing Visit only FILLS that Visit's empty new columns; nothing else on the Visit is touched;
//  - an entry with a patient and no Visit becomes a NEW Visit (marked backfilledAt, no transcript);
//  - an entry with no patient stays where it is (staging list);
//  - nothing is ever deleted, repointed or overwritten.
// Counts only: no names, no free text leave this module.

import { parseSpan } from "../notes/scheduleTime";

export type EntryRow = {
  id: string; date: string; section: string; timeLabel: string; trackName: string; typeName: string;
  providerId: string | null; providerName: string; absent: boolean; canceled: boolean; completed: boolean; missed: boolean;
  patientId: string | null; visitId: string | null; createdAt: Date;
};
export type VisitRow = {
  id: string; patientId: string; visitDate: string; providerName: string; backfilledAt: Date | null;
  legacyScheduleEntryId: string | null; startTime: string | null; endTime: string | null; timeLabel: string | null;
  section: string | null; trackName: string | null; providerId: string | null;
};
export type ProviderRow = { id: string; name: string; trackingOnly: boolean };
export type PatientRow = { id: string; mergedIntoId: string | null };

export type FillPatch = Partial<Pick<VisitRow, "legacyScheduleEntryId" | "startTime" | "endTime" | "timeLabel" | "section" | "trackName" | "providerId">>;
export type InsertData = {
  entryId: string; patientId: string; visitDate: string; appointmentType: string; program: string; apptTime: string;
  providerName: string; status: string; legacyScheduleEntryId: string; startTime: string | null; endTime: string | null;
  timeLabel: string | null; section: string | null; trackName: string | null; providerId: string | null;
};
export type Counts = {
  entries: number; visits: number;
  mirrored: number; mirroredMissingVisit: number; duplicateClaims: number;
  withPatientNoVisit: number; noPatient: number; trackingOnly: number;
  alreadyDone: number; toFill: number; toInsert: number;
  unparsableTime: number; statusConflicts: number; possibleDuplicates: number; patientUnresolved: number;
};
export type Plan = { fills: { visitId: string; entryId: string; patch: FillPatch }[]; inserts: InsertData[]; counts: Counts };

const pad = (n: number) => String(n).padStart(2, "0");
const hhmm = (m: number) => `${pad(Math.floor(m / 60) % 24)}:${pad(m % 60)}`;

/** Exact time -> start only; range -> start and end; anything else -> nothing (the text is kept in timeLabel). */
export function timeColumns(label: string): { startTime: string | null; endTime: string | null; parsed: boolean } {
  const span = parseSpan(label ?? "");
  if (!span) return { startTime: null, endTime: null, parsed: false };
  return { startTime: hhmm(span.start), endTime: span.exact ? null : hhmm(span.end), parsed: true };
}

/** cancelled > no_show (absent) > missed > seen (completed) > scheduled. `conflict` when more than one flag is set. */
export function statusFromFlags(e: Pick<EntryRow, "absent" | "canceled" | "completed" | "missed">): { status: string; conflict: boolean } {
  const set = [e.canceled, e.absent, e.missed, e.completed].filter(Boolean).length;
  const status = e.canceled ? "cancelled" : e.absent ? "no_show" : e.missed ? "missed" : e.completed ? "seen" : "scheduled";
  return { status, conflict: set > 1 };
}

const byOldest = (a: EntryRow, b: EntryRow) => a.createdAt.getTime() - b.createdAt.getTime() || (a.id < b.id ? -1 : 1);

export function planBackfill(input: { entries: EntryRow[]; visits: VisitRow[]; providers: ProviderRow[]; patients: PatientRow[] }): Plan {
  const { entries, visits, providers, patients } = input;
  const visitById = new Map(visits.map((v) => [v.id, v]));
  const doneEntryIds = new Set(visits.map((v) => v.legacyScheduleEntryId).filter((x): x is string => !!x));
  const providerById = new Map(providers.map((p) => [p.id, p]));
  const providerByName = new Map(providers.map((p) => [p.name.trim().toLowerCase(), p]));
  const mergedInto = new Map(patients.map((p) => [p.id, p.mergedIntoId]));
  const surviving = (id: string): string | null => {
    let cur = id;
    for (let i = 0; i < 10; i++) {
      if (!mergedInto.has(cur)) return null;
      const next = mergedInto.get(cur);
      if (!next) return cur;
      cur = next;
    }
    return null;
  };
  const sameDay = new Map<string, number>();
  for (const v of visits) if (!v.backfilledAt) sameDay.set(`${v.patientId}|${v.visitDate}`, (sameDay.get(`${v.patientId}|${v.visitDate}`) ?? 0) + 1);

  const counts: Counts = {
    entries: entries.length, visits: visits.length, mirrored: 0, mirroredMissingVisit: 0, duplicateClaims: 0,
    withPatientNoVisit: 0, noPatient: 0, trackingOnly: 0, alreadyDone: 0, toFill: 0, toInsert: 0,
    unparsableTime: 0, statusConflicts: 0, possibleDuplicates: 0, patientUnresolved: 0,
  };
  const fills: Plan["fills"] = [];
  const inserts: InsertData[] = [];
  const claimed = new Set<string>(); // visit ids already claimed by an older entry in this run

  for (const e of [...entries].sort(byOldest)) {
    const provider = (e.providerId && providerById.get(e.providerId)) || providerByName.get(e.providerName.trim().toLowerCase()) || null;
    if (provider?.trackingOnly) counts.trackingOnly++;
    const t = timeColumns(e.timeLabel);
    const cols = { startTime: t.startTime, endTime: t.endTime, timeLabel: e.timeLabel || null, section: e.section || null, trackName: e.trackName || null };

    const visit = e.visitId ? visitById.get(e.visitId) : undefined;
    if (e.visitId && !visit) counts.mirroredMissingVisit++;

    if (visit) {
      counts.mirrored++;
      if (claimed.has(visit.id) || (visit.legacyScheduleEntryId && visit.legacyScheduleEntryId !== e.id)) {
        counts.duplicateClaims++; // a second entry pointing at the same Visit: the oldest wins, this one is only reported
        continue;
      }
      claimed.add(visit.id);
      if (!t.parsed && e.section !== "TRACK" && e.timeLabel.trim()) counts.unparsableTime++;
      const want: FillPatch = {
        legacyScheduleEntryId: e.id, ...cols,
        providerId: e.providerId ?? providerByName.get(visit.providerName.trim().toLowerCase())?.id ?? null,
      };
      const patch: FillPatch = {};
      for (const k of Object.keys(want) as (keyof FillPatch)[]) if (visit[k] === null && want[k] !== null && want[k] !== undefined) (patch as Record<string, unknown>)[k] = want[k];
      if (Object.keys(patch).length === 0) counts.alreadyDone++;
      else { counts.toFill++; fills.push({ visitId: visit.id, entryId: e.id, patch }); }
      continue;
    }

    // No live Visit for this entry.
    if (doneEntryIds.has(e.id)) { counts.alreadyDone++; continue; } // inserted by an earlier run
    if (e.visitId) continue; // points at a Visit that no longer exists (deleted on purpose?): reported above, never recreated
    if (!e.patientId) { counts.noPatient++; continue; }
    counts.withPatientNoVisit++;
    const pid = surviving(e.patientId);
    if (!pid) { counts.patientUnresolved++; continue; }
    if (!t.parsed && e.section !== "TRACK" && e.timeLabel.trim()) counts.unparsableTime++;
    const st = statusFromFlags(e);
    if (st.conflict) counts.statusConflicts++;
    if ((sameDay.get(`${pid}|${e.date}`) ?? 0) > 0) counts.possibleDuplicates++;
    counts.toInsert++;
    inserts.push({
      entryId: e.id, patientId: pid, visitDate: e.date, appointmentType: e.typeName,
      program: e.section === "TRACK" ? e.trackName : "", apptTime: t.parsed ? e.timeLabel : "",
      providerName: provider?.name ?? e.providerName, status: st.status, legacyScheduleEntryId: e.id,
      ...cols, providerId: e.providerId ?? provider?.id ?? null,
    });
  }
  return { fills, inserts, counts };
}
