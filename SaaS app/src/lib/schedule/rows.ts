// Release B1: the Schedule reads Visits (the unified appointment). Rows that are not a Visit yet (no patient) still come
// from ScheduleEntry as "staging" rows. This module turns both into the one EntryDTO the grid already uses.

import type { UnmatchedAppointment, Visit } from "@prisma/client";
import type { ScheduleEntry } from "../scheduleTypes";
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

/** A staging row (no patient yet) shaped like a ScheduleEntry for the shared DTO builder. */
export function unmatchedAsEntry(u: UnmatchedAppointment): ScheduleEntry {
  return { ...u, visitId: null };
}

export async function trackingOnlyNames(): Promise<string[]> {
  const rows = await db.provider.findMany({ where: { trackingOnly: true }, select: { name: true } });
  return rows.map((r) => r.name.toLowerCase());
}

export type ScheduleRange = { from: string; to: string; providerId?: string; includeVisits: boolean; includeStaging: boolean };

export async function scheduleRows(r: ScheduleRange): Promise<{ visits: EntryDTO[]; staging: EntryDTO[] }> {
  let visits: EntryDTO[] = [];
  if (r.includeVisits) {
    const vs = await db.visit.findMany({
      where: { visitDate: { gte: r.from, lte: r.to }, ...(r.providerId ? { providerId: r.providerId } : {}) },
      include: { patient: { select: { lastName: true, firstName: true } } },
    });
    const hidden = new Set(await trackingOnlyNames()); // tracking-only providers stay off the schedule grid
    visits = await entryDTOs(vs.filter((v) => !hidden.has(v.providerName.toLowerCase())).sort(byTime).map(visitAsEntry));
  }
  let staging: EntryDTO[] = [];
  if (r.includeStaging) {
    const rows = await db.unmatchedAppointment.findMany({
      where: { date: { gte: r.from, lte: r.to }, ...(r.providerId ? { providerId: r.providerId } : {}) },
      orderBy: [{ date: "asc" }, { createdAt: "asc" }],
    });
    staging = await entryDTOs(rows.map(unmatchedAsEntry));
  }
  return { visits, staging };
}
