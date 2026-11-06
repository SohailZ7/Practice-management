// Keeps the Schedule page in step with Notes visits: every visit (web or recorder) has one ScheduleEntry row for its
// date, carrying the same patient, provider, program and time. The Schedule row points back with visitId, so the
// visit, its transcript and its documents are one click away. Idempotent: running it twice never makes a second row.

import { db } from "../db";
import { makeDedupeKey } from "../import/outpatientBoard";

/** Pure mapping, for tests. A program means a track row (the track name is its label); no program means a psych-eval row at the appointment time. */
export function scheduleFieldsFor(v: { program: string; apptTime: string; appointmentType: string }) {
  const program = v.program.trim();
  return program
    ? { section: "TRACK", timeLabel: program, trackName: program, typeName: v.appointmentType }
    : { section: "PSYCH_EVAL", timeLabel: v.apptTime, trackName: "", typeName: v.appointmentType };
}

export async function syncScheduleForVisit(visitId: string): Promise<"created" | "updated" | "missing"> {
  const v = await db.visit.findUnique({ where: { id: visitId }, include: { patient: true } });
  if (!v) return "missing";
  const provider = v.providerName ? await db.provider.findFirst({ where: { name: { equals: v.providerName, mode: "insensitive" } } }) : null;
  const f = scheduleFieldsFor(v);
  const clientInfo = `${v.patient.lastName}, ${v.patient.firstName}`.trim();
  const data = {
    date: v.visitDate,
    ...f,
    clientInfo,
    providerId: provider?.id ?? null,
    providerName: provider?.name ?? v.providerName,
    patientId: v.patientId,
    visitId: v.id,
    dedupeKey: makeDedupeKey({ date: v.visitDate, section: f.section, timeLabel: f.timeLabel, providerName: v.providerName, clientInfo }),
  };
  const existing = await db.scheduleEntry.findFirst({ where: { visitId: v.id }, select: { id: true } });
  if (existing) {
    await db.scheduleEntry.update({ where: { id: existing.id }, data });
    return "updated";
  }
  await db.scheduleEntry.create({ data });
  return "created";
}

export async function removeScheduleForVisits(visitIds: string[]) {
  if (visitIds.length) await db.scheduleEntry.deleteMany({ where: { visitId: { in: visitIds } } });
}
