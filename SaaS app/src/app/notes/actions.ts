"use server";

import { revalidatePath } from "next/cache";
import { cookies } from "next/headers";
import { Prisma } from "@prisma/client";
import { db } from "@/lib/db";
import { audit } from "@/lib/audit";
import { requireAccess } from "@/lib/session";
import { isISODate } from "@/lib/dates";
import { stagingPromoteConfig } from "@/lib/promote/webConfig";
import { loadScheduleForDate } from "@/lib/notes/loadSchedule";
import { generateDocuments } from "@/lib/notes/generate";
import { makeLlm, modelConfigured, warmModel } from "@/lib/notes/model";
import { isDraft } from "@/lib/notes/markdown";
import { priorDocument } from "@/lib/notes/queries";
import { loadVisitOptions } from "@/lib/notes/options";
import { assertBillableVisit, isTrackingOnlyName, TRACKING_ONLY_MESSAGE } from "@/lib/notes/trackingOnly";
import { sanitizeLabels } from "@/lib/transcript/labels";
import { canAccess } from "@/lib/access";
import { providerChangeError, splitPatch } from "@/lib/notes/visitEdit";
import { NOTE_KINDS, isNoteKind, canWriteKind, canResolve, cleanNoteBody, type VisitNoteDTO } from "@/lib/notes/visitNotes";
import { addVisit, deleteVisit, deleteVisits, updateVisit, VisitError, type VisitPatch } from "@/lib/notes/visitService";

// Audit entries hold ids and counts only, never patient names or note text.

const MAX_TRANSCRIPT = 200_000;

/** Loads a day from a pasted board. The parsing and the rules live in loadScheduleForDate, shared with the recorder. */
export async function loadPastedSchedule(date: string, pasted: string, provider: string) {
  const user = await requireAccess("notes", "edit");
  if (!isISODate(date)) throw new Error("Invalid date");
  const r = await loadScheduleForDate(date, pasted, provider, user);
  await audit(user.email, "notes.schedule.paste", `${date} rows=${r.kept} visits=${r.created}`);
  revalidatePath("/notes"); revalidatePath("/schedule");
  return { created: r.created, summary: { kept: r.kept, skippedNoClient: r.skippedNoClient, skippedOtherProvider: r.skippedOtherProvider }, otherProviders: r.otherProviders };
}

/** Stores the transcript the recorder produced. The audio itself never reaches the server. */
export async function saveTranscript(visitId: string, transcript: string) {
  const user = await requireAccess("notes", "edit");
  await assertBillableVisit(visitId);
  await db.visit.update({ where: { id: visitId }, data: { transcript: transcript.slice(0, MAX_TRANSCRIPT), transcriptAt: new Date() } });
  await audit(user.email, "notes.transcript.save", `visit ${visitId} chars=${transcript.length}`);
  revalidatePath("/notes"); revalidatePath("/schedule");
}

/** Writes every document this visit's appointment type calls for. Existing documents are left alone. */
export async function generateForVisit(visitId: string) {
  const user = await requireAccess("notes", "edit");
  const visit = await db.visit.findUnique({ where: { id: visitId }, include: { patient: true, documents: true } });
  if (!visit) throw new Error("Visit not found");
  await assertBillableVisit(visitId);
  if (!visit.transcript.trim()) throw new Error("This visit has no transcript yet.");
  // Returned, not thrown: Next.js hides thrown messages in production, and this one is meant to be read.
  if (!modelConfigured()) {
    return { created: 0, skipped: 0, error: "No note-writing model is set up yet. Ask the administrator to configure one." };
  }

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
  revalidatePath("/notes"); revalidatePath("/schedule");
  return { created: made.length, skipped: docs.length - made.length, error: undefined as string | undefined };
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
  revalidatePath("/notes"); revalidatePath("/schedule");
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

// Thrown messages are hidden in production, so these return the message for the page to show.
async function guard<T>(fn: () => Promise<T>): Promise<{ ok: true; value: T } | { ok: false; error: string }> {
  try {
    return { ok: true, value: await fn() };
  } catch (e) {
    if (e instanceof VisitError) return { ok: false, error: e.message };
    throw e;
  }
}

/** Adds one visit by hand, in addition to pasting a whole board. */
export async function addVisitAction(input: { date: string; patientId: string } & VisitPatch) {
  const user = await requireAccess("notes", "edit");
  // Web form is patient-first: a visit links to an existing patient picked by search (or created first), never free text.
  if (!input.patientId) return { ok: false as const, error: "Search for the patient and pick them, or add a new patient first." };
  const r = await guard(() => addVisit(user, input));
  revalidatePath("/notes"); revalidatePath("/schedule");
  return r.ok ? { ok: true as const } : r;
}

/** Per-person choice: schedule times as 0900-1200. A plain cookie; it holds no patient data. */
export async function setClockStyle(military: boolean) {
  await requireAccess("notes", "view");
  cookies().set("bbc_clock", military ? "24" : "12", { sameSite: "lax", path: "/", maxAge: 60 * 60 * 24 * 365 });
  revalidatePath("/schedule");
}

export async function updateVisitAction(id: string, patch: VisitPatch) {
  const user = await requireAccess("notes", "edit");
  // Provider column: a provider may claim a visit for themselves, only an admin assigns someone else.
  if (patch.providerName !== undefined) {
    const current = await db.visit.findUnique({ where: { id }, select: { providerName: true } });
    const own = user.role === "PROVIDER" ? (await db.provider.findFirst({ where: { employee: { email: user.email } }, select: { name: true } }))?.name ?? null : null;
    const bad = providerChangeError(user.role, own, current?.providerName ?? "", patch.providerName);
    if (bad) return { ok: false as const, error: bad, code: "forbidden" };
  }
  // Staff edits to time, program or type wait for an admin; status and the rest apply now.
  const { now, needsApproval } = splitPatch(user.role, patch as Record<string, unknown>);
  let pending = false;
  if (Object.keys(needsApproval).length) {
    if (!(await db.visit.findUnique({ where: { id }, select: { id: true } }))) return { ok: false as const, error: "Visit not found.", code: "not_found" };
    const row = await db.visitChangeRequest.create({ data: { visitId: id, patch: needsApproval as Prisma.InputJsonValue, requestedBy: user.email } });
    await audit(user.email, "notes.visit.changeRequest", `visit ${id} request ${row.id} fields=${Object.keys(needsApproval).join(",")}`);
    pending = true;
  }
  if (Object.keys(now).length) {
    const r = await guard(() => updateVisit(user, id, now as VisitPatch));
    revalidatePath("/notes"); revalidatePath("/schedule");
    if (!r.ok) return r;
  }
  revalidatePath("/notes");
  return { ok: true as const, pending };
}

/** Change requests for one visit (everyone with Notes view); admins also see who asked. */
export async function listChangeRequests(visitId: string) {
  const user = await requireAccess("notes", "view");
  const rows = await db.visitChangeRequest.findMany({ where: { visitId, status: "pending" }, orderBy: { createdAt: "asc" } });
  return { isAdmin: user.role === "ADMIN", rows: rows.map((r) => ({ id: r.id, patch: r.patch as Record<string, string>, by: r.requestedBy, at: r.createdAt.getTime() })) };
}

/** Admin approves (applies the change) or rejects a staff edit. */
export async function decideChangeRequest(id: string, approve: boolean): Promise<{ ok: true } | { ok: false; error: string }> {
  const user = await requireAccess("notes", "edit");
  if (user.role !== "ADMIN") return { ok: false, error: "Only an admin can approve changes." };
  const row = await db.visitChangeRequest.findUnique({ where: { id } });
  if (!row || row.status !== "pending") return { ok: false, error: "That request is no longer pending." };
  if (approve) {
    const r = await guard(() => updateVisit(user, row.visitId, row.patch as VisitPatch));
    if (!r.ok) return r;
  }
  await db.visitChangeRequest.update({ where: { id }, data: { status: approve ? "approved" : "rejected", decidedBy: user.email, decidedAt: new Date() } });
  await audit(user.email, "notes.visit.changeDecision", `request ${id} visit ${row.visitId} ${approve ? "approved" : "rejected"}`);
  revalidatePath("/notes"); revalidatePath("/schedule");
  return { ok: true };
}

export async function deleteVisitAction(id: string) {
  const user = await requireAccess("notes", "edit");
  const r = await guard(() => deleteVisit(user, id));
  revalidatePath("/notes"); revalidatePath("/schedule");
  return r.ok ? { ok: true as const } : r;
}

export async function deleteVisitsAction(ids: string[]) {
  const user = await requireAccess("notes", "edit");
  const r = await guard(() => deleteVisits(user, Array.isArray(ids) ? ids.filter((i) => typeof i === "string") : []));
  revalidatePath("/notes"); revalidatePath("/schedule");
  return r.ok ? { ok: true as const, deleted: r.value.deleted.length } : r;
}

export async function visitOptions() {
  await requireAccess("notes", "edit");
  return loadVisitOptions();
}

/** The stored transcript for the read-only pop-up. Returned, not thrown, so a missing visit reads as a message. */
export async function getVisitTranscript(visitId: string) {
  const user = await requireAccess("notes", "view");
  const v = await db.visit.findUnique({ where: { id: visitId }, select: { transcript: true, transcriptAt: true, createdAt: true, speakerLabels: true } });
  if (!v) return { ok: false as const, error: "Visit not found." };
  await audit(user.email, "notes.transcript.read", `visit ${visitId} chars=${v.transcript.length}`);
  return { ok: true as const, transcript: v.transcript, updatedAt: (v.transcriptAt ?? v.createdAt).toISOString(), labels: sanitizeLabels(v.speakerLabels) };
}

/** Saves who each speaker in the transcript is (display only; the transcript text is not touched). Needs Notes edit. */
export async function saveSpeakerLabels(visitId: string, labels: unknown) {
  const user = await requireAccess("notes", "edit");
  const clean = sanitizeLabels(labels);
  const v = await db.visit.findUnique({ where: { id: visitId }, select: { id: true } });
  if (!v) return { ok: false as const, error: "Visit not found." };
  await db.visit.update({ where: { id: visitId }, data: { speakerLabels: Object.keys(clean).length ? clean : Prisma.DbNull } });
  await audit(user.email, "notes.transcript.speakers", `visit ${visitId} labels=${Object.keys(clean).length}`);
  return { ok: true as const, labels: clean };
}

/**
 * What the staging "Promote to production" button copies for one visit. Admin only, and only where the button is
 * configured (staging with a production address). The patient's name and transcript go to this admin's browser, which
 * sends them straight to production under the admin's own production sign-in. The audit holds ids and counts only.
 */
export async function getPromoteSource(visitId: string) {
  const user = await requireAccess("notes", "edit");
  if (user.role !== "ADMIN") return { ok: false as const, error: "Only an admin can promote a visit." };
  if (!stagingPromoteConfig(process.env)) return { ok: false as const, error: "Promote to production is not set up here." };
  if (!user.showFullNames) return { ok: false as const, error: "Full names are off for your account (production needs the name)." };
  const v = await db.visit.findUnique({ where: { id: visitId }, include: { patient: true } });
  if (!v) return { ok: false as const, error: "Visit not found." };
  if (await isTrackingOnlyName(v.providerName)) return { ok: false as const, error: TRACKING_ONLY_MESSAGE };
  if (!v.transcript.trim()) return { ok: false as const, error: "Record the visit first: there is no transcript to promote." };
  await audit(user.email, "notes.promote.read", `visit ${visitId} chars=${v.transcript.length}`);
  return {
    ok: true as const,
    source: {
      date: v.visitDate, fullName: `${v.patient.firstName} ${v.patient.lastName}`.trim(), apptTime: v.apptTime, program: v.program,
      appointmentType: v.appointmentType, providerName: v.providerName, transcript: v.transcript,
    },
  };
}

/** Records that an admin pressed Promote and how it ended. No names or text. */
export async function recordPromote(visitId: string, outcome: "promoted" | "already" | "failed") {
  const user = await requireAccess("notes", "edit");
  if (user.role !== "ADMIN") return;
  await audit(user.email, "notes.promote", `visit ${visitId} ${outcome}`);
}

// Visit notes (comment-style). Audit entries hold ids only, never the note text.
export async function listVisitNotes(visitId: string): Promise<{ notes: VisitNoteDTO[]; allowedKinds: string[]; me: string }> {
  const user = await requireAccess("notes", "view");
  const rows = await db.visitNote.findMany({ where: { visitId }, orderBy: { createdAt: "asc" } });
  const canEdit = canAccess(user, "notes", "edit");
  return { notes: rows.map(noteDto), allowedKinds: canEdit ? NOTE_KINDS.filter((k) => canWriteKind(user.role, k.value)).map((k) => k.value) : [], me: user.email };
}

export async function addVisitNote(visitId: string, kind: string, body: string): Promise<{ ok: true; note: VisitNoteDTO } | { ok: false; error: string }> {
  const user = await requireAccess("notes", "edit");
  if (!isNoteKind(kind)) return { ok: false, error: "Choose a note type." };
  if (!canWriteKind(user.role, kind)) return { ok: false, error: kind === "admin" ? "Only an admin can write an admin note." : "Only a provider or admin can write a provider note." };
  const text = cleanNoteBody(body);
  if (!text) return { ok: false, error: "Write the note first." };
  if (!(await db.visit.findUnique({ where: { id: visitId }, select: { id: true } }))) return { ok: false, error: "Visit not found." };
  const row = await db.visitNote.create({ data: { visitId, kind, body: text, authorEmail: user.email, authorName: user.name } });
  await audit(user.email, "notes.visit.note.add", `visit ${visitId} note ${row.id} kind=${kind}`);
  return { ok: true, note: noteDto(row) };
}

export async function setVisitNoteResolved(noteId: string, resolved: boolean): Promise<{ ok: true } | { ok: false; error: string }> {
  const user = await requireAccess("notes", "edit");
  const note = await db.visitNote.findUnique({ where: { id: noteId } });
  if (!note) return { ok: false, error: "Note not found." };
  if (!canResolve(user.role, note.authorEmail, user.email)) return { ok: false, error: "Only the author or an admin can change this." };
  await db.visitNote.update({ where: { id: noteId }, data: resolved ? { resolvedAt: new Date(), resolvedByEmail: user.email } : { resolvedAt: null, resolvedByEmail: null } });
  await audit(user.email, "notes.visit.note.resolve", `note ${noteId} resolved=${resolved}`);
  return { ok: true };
}

function noteDto(r: { id: string; kind: string; body: string; authorName: string; createdAt: Date; resolvedAt: Date | null; resolvedByEmail: string | null }): VisitNoteDTO {
  return { id: r.id, kind: r.kind, body: r.body, author: r.authorName, at: r.createdAt.getTime(), resolved: r.resolvedAt !== null, resolvedBy: r.resolvedByEmail };
}
