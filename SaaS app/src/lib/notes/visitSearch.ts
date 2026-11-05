// Finding a visit by the patient's initials and/or its date. Returns the same fields the desktop visit routes already
// return (initials, program, type, provider, time), never names or other identifiers.

import { db } from "../db";
import { patientInitials } from "./patientFolder";

export const MAX_SEARCH_RESULTS = 50;

/** "ab", "A.B." or "A B" to "AB"; null when no letters, or more than 3. */
export function normalizeInitials(raw: string): string | null {
  const letters = (raw.match(/\p{L}/gu) ?? []).join("").toUpperCase();
  return letters.length >= 1 && letters.length <= 3 ? letters : null;
}

const lettersOf = (initials: string) => normalizeInitials(initials) ?? "";

export type VisitHit = {
  id: string;
  date: string;
  time: string;
  program: string;
  type: string;
  provider: string;
  initials: string;
  hasTranscript: boolean;
  hasDocuments: boolean;
};

export async function searchVisits(q: { initials?: string; date?: string }): Promise<VisitHit[]> {
  let patientIds: string[] | undefined;
  if (q.initials) {
    const want = normalizeInitials(q.initials) ?? "";
    const patients = await db.billingPatient.findMany({ where: { mergedIntoId: null }, select: { id: true, lastName: true, firstName: true } });
    patientIds = patients.filter((p) => lettersOf(patientInitials(p.lastName, p.firstName)) === want).map((p) => p.id);
    if (patientIds.length === 0) return [];
  }
  const visits = await db.visit.findMany({
    where: { ...(q.date ? { visitDate: q.date } : {}), ...(patientIds ? { patientId: { in: patientIds } } : {}) },
    include: { patient: { select: { lastName: true, firstName: true } }, documents: { select: { id: true } } },
    orderBy: [{ visitDate: "desc" }, { createdAt: "desc" }],
    take: MAX_SEARCH_RESULTS,
  });
  return visits.map((v) => ({
    id: v.id,
    date: v.visitDate,
    time: v.apptTime,
    program: v.program,
    type: v.appointmentType,
    provider: v.providerName,
    initials: patientInitials(v.patient.lastName, v.patient.firstName),
    hasTranscript: v.transcript.trim().length > 0,
    hasDocuments: v.documents.length > 0,
  }));
}
