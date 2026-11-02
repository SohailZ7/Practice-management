"use server";

import { revalidatePath } from "next/cache";
import { db } from "@/lib/db";
import { audit } from "@/lib/audit";
import { requireAccess } from "@/lib/session";
import { isISODate } from "@/lib/dates";
import { loadScheduleForDate } from "@/lib/notes/loadSchedule";
import { generateDocuments } from "@/lib/notes/generate";
import { makeLlm, warmModel } from "@/lib/notes/model";
import { isDraft } from "@/lib/notes/markdown";
import { priorDocument } from "@/lib/notes/queries";

// Audit entries hold ids and counts only, never patient names or note text.

const MAX_TRANSCRIPT = 200_000;

/** Loads a day from a pasted board. The parsing and the rules live in loadScheduleForDate, shared with the recorder. */
export async function loadPastedSchedule(date: string, pasted: string, provider: string) {
  const user = await requireAccess("notes", "edit");
  if (!isISODate(date)) throw new Error("Invalid date");
  const r = await loadScheduleForDate(date, pasted, provider, user);
  await audit(user.email, "notes.schedule.paste", `${date} rows=${r.kept} visits=${r.created}`);
  revalidatePath("/notes");
  return { created: r.created, summary: { kept: r.kept, skippedNoClient: r.skippedNoClient, skippedOtherProvider: r.skippedOtherProvider }, otherProviders: r.otherProviders };
}

/** Stores the transcript the recorder produced. The audio itself never reaches the server. */
export async function saveTranscript(visitId: string, transcript: string) {
  const user = await requireAccess("notes", "edit");
  await db.visit.update({ where: { id: visitId }, data: { transcript: transcript.slice(0, MAX_TRANSCRIPT) } });
  await audit(user.email, "notes.transcript.save", `visit ${visitId} chars=${transcript.length}`);
  revalidatePath("/notes");
}

/** Writes every document this visit's appointment type calls for. Existing documents are left alone. */
export async function generateForVisit(visitId: string) {
  const user = await requireAccess("notes", "edit");
  const visit = await db.visit.findUnique({ where: { id: visitId }, include: { patient: true, documents: true } });
  if (!visit) throw new Error("Visit not found");
  if (!visit.transcript.trim()) throw new Error("This visit has no transcript yet.");

  const prior = await priorDocument(visit.patientId, visit.visitDate);
  const docs = await generateDocuments({
    appointmentType: visit.appointmentType,
    transcript: visit.transcript,
    visitDate: visit.visitDate,
    patientLabel: `${visit.patient.lastName}, ${visit.patient.firstName}`,
    providerName: visit.providerName,
    priorNote: prior,
    llm: makeLlm(),
  });

  const made = docs.filter((d) => !visit.documents.some((e) => e.kind === d.kind));
  for (const d of made) {
    await db.visitDocument.create({
      data: { visitId, kind: d.kind, label: d.label, markdown: d.markdown, draft: true, attention: d.attention.join("\n") },
    });
  }
  await audit(user.email, "notes.generate", `visit ${visitId} documents=${made.length}`);
  revalidatePath("/notes");
  return { created: made.length, skipped: docs.length - made.length };
}

/** Saves an edit, keeping the previous text as a version so nothing a provider wrote is lost. */
export async function saveDocument(documentId: string, markdown: string) {
  const user = await requireAccess("notes", "edit");
  const doc = await db.visitDocument.findUnique({ where: { id: documentId } });
  if (!doc) throw new Error("Document not found");
  if (doc.markdown === markdown) return { saved: false, draft: doc.draft };

  await db.$transaction([
    db.visitDocumentVersion.create({ data: { documentId, markdown: doc.markdown, savedByEmail: user.email } }),
    db.visitDocument.update({ where: { id: documentId }, data: { markdown, draft: isDraft(markdown) } }),
  ]);
  await audit(user.email, "notes.document.save", `document ${documentId} draft=${isDraft(markdown)}`);
  revalidatePath("/notes");
  return { saved: true, draft: isDraft(markdown) };
}

export async function getDocument(documentId: string) {
  await requireAccess("notes", "view");
  const doc = await db.visitDocument.findUnique({ where: { id: documentId } });
  if (!doc) throw new Error("Document not found");
  return { id: doc.id, label: doc.label, markdown: doc.markdown, draft: doc.draft };
}

/** Asks the model to load, so the wait happens during the visit rather than after it. */
export async function warmUp() {
  await requireAccess("notes", "edit");
  return warmModel();
}
