// Release B1: the Schedule reads Visits (the unified appointment). Rows that are not a Visit yet (no patient) still come
// from ScheduleEntry as "staging" rows. This module turns both into the one EntryDTO the grid already uses.

import type { ScheduleEntry, Visit } from "@prisma/client";
import { db } from "../db";
import { entryDTOs } from "../patients";
import type { EntryDTO } from "../scheduleTypes";
import { flagsForStatus } from "../notes/visitStatus";
import { scheduleFieldsFor } from "../notes/visitSchedule";

type VisitWithPatient = Visit & { patient: { lastName: string; firstName: string } };

/** A Visit shaped like a ScheduleEntry row, so one DTO builder (patient merge, consent badge) serves both. Pure. */
export function visitAsEntry(v: VisitWithPatient): ScheduleEntry {
  const f = scheduleFieldsFor(v);
  const section = v.section === "TRACK" || v.section === "PSYCH_EVAL" ? v.section : f.section;
  return {
    id: v.id,
    date: v.visitDate,
    section,
    timeLabel: v.timeLabel ?? f.timeLabel,
    trackName: v.trackName ?? f.trackName,
    typeName: v.appointmentType,
    clientInfo: `${v.patient.lastName}, ${v.patient.firstName}`.trim(),
    providerId: v.providerId,
    providerName: v.providerName,
    ...flagsForStatus(v.status),
    dedupeKey: "",
    importLogId: null,
    patientId: v.patientId,
    visitId: v.id,
    createdAt: v.createdAt,
  };
}

/** Sort key: exact start time first, then by text; rows without a parsed time keep their creation order after. */
export function byTime(a: { startTime?: string | null; createdAt: Date }, b: { startTime?: string | null; createdAt: Date }) {
  if (a.startTime && b.startTime && a.startTime !== b.startTime) return a.startTime < b.startTime ? -1 : 1;
  if (!!a.startTime !== !!b.startTime) return a.startTime ? -1 : 1;
  return a.createdAt.getTime() - b.createdAt.getTime();
}

/**
 * Staging rows: schedule rows that are not a Visit (and not the mirror of one). Pure so it can be tested.
 * `legacyIds` are the ScheduleEntry ids that a live Visit already carries.
 */
export function stagingOnly<T extends { id: string; visitId: string | null }>(entries: T[], legacyIds: Set<string>, visitIds: Set<string>): T[] {
  return entries.filter((e) => !e.visitId || !visitIds.has(e.visitId)).filter((e) => !legacyIds.has(e.id));
}

export async function trackingOnlyNames(): Promise<string[]> {
  const rows = await db.provider.findMany({ where: { trackingOnly: true }, select: { name: true } });
  return rows.map((r) => r.name.toLowerCase());
}

export type ScheduleRange = { from: string; to: string; providerId?: string; includeVisits: boolean; includeStaging: boolean };

export async function scheduleRows(r: ScheduleRange): Promise<{ visits: EntryDTO[]; staging: EntryDTO[] }> {
  let visits: EntryDTO[] = [];
  let legacy = new Set<string>();
  let visitIds = new Set<string>();
  if (r.includeVisits || r.includeStaging) {
    const vs = await db.visit.findMany({
      where: { visitDate: { gte: r.from, lte: r.to }, ...(r.providerId ? { providerId: r.providerId } : {}) },
      include: { patient: { select: { lastName: true, firstName: true } } },
    });
    // Needed even when only staging is wanted, so mirrored rows are never listed twice.
    const all = r.providerId ? await db.visit.findMany({ where: { visitDate: { gte: r.from, lte: r.to } }, select: { id: true, legacyScheduleEntryId: true } }) : vs;
    legacy = new Set(all.map((v) => v.legacyScheduleEntryId).filter((x): x is string => !!x));
    visitIds = new Set(all.map((v) => v.id));
    if (r.includeVisits) {
      const hidden = new Set(await trackingOnlyNames()); // tracking-only providers stay off the schedule grid
      const shown = vs.filter((v) => !hidden.has(v.providerName.toLowerCase())).sort(byTime);
      visits = await entryDTOs(shown.map(visitAsEntry));
    }
  }
  let staging: EntryDTO[] = [];
  if (r.includeStaging) {
    const rows = await db.scheduleEntry.findMany({
      where: { date: { gte: r.from, lte: r.to }, ...(r.providerId ? { providerId: r.providerId } : {}) },
      orderBy: [{ date: "asc" }, { createdAt: "asc" }],
    });
    staging = await entryDTOs(stagingOnly(rows, legacy, visitIds));
  }
  return { visits, staging };
}
