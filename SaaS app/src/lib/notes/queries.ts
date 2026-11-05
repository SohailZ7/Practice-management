// Reading visits and their documents. Patient names are shown as initials on the board (change request 16).

import { db } from "../db";
import { patientInitials } from "./patientFolder";

export type DocumentRow = { id: string; kind: string; label: string; draft: boolean; updatedAt: string; /** Filled in once the versioned store exists. */ latestVersion?: number };

export type VisitRow = {
  id: string;
  patientId: string;
  initials: string;
  visitDate: string;
  appointmentType: string;
  program: string;
  apptTime: string;
  providerName: string;
  hasTranscript: boolean;
  documents: DocumentRow[];
};

export async function visitsForDate(date: string): Promise<VisitRow[]> {
  const visits = await db.visit.findMany({
    where: { visitDate: date },
    include: { patient: true, documents: { orderBy: { label: "asc" } } },
    orderBy: { createdAt: "asc" },
  });
  return visits.map((v) => ({
    id: v.id,
    patientId: v.patientId,
    initials: patientInitials(v.patient.lastName, v.patient.firstName),
    visitDate: v.visitDate,
    appointmentType: v.appointmentType,
    program: v.program,
    apptTime: v.apptTime,
    providerName: v.providerName,
    hasTranscript: v.transcript.trim().length > 0,
    documents: v.documents.map((d) => ({
      id: d.id,
      kind: d.kind,
      label: d.label,
      draft: d.draft,
      updatedAt: d.updatedAt.toISOString(),
    })),
  }));
}

/** The patient's most recent document before this visit, for the carry-forward. */
export async function priorDocument(patientId: string, beforeDate: string) {
  const visit = await db.visit.findFirst({
    where: { patientId, visitDate: { lt: beforeDate } },
    include: { documents: { orderBy: { createdAt: "asc" }, take: 1 } },
    orderBy: { visitDate: "desc" },
  });
  const doc = visit?.documents[0];
  return doc ? { label: `${visit!.visitDate} ${doc.label}`, markdown: doc.markdown } : undefined;
}
