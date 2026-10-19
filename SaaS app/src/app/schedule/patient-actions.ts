"use server";

import { revalidatePath } from "next/cache";
import { db } from "@/lib/db";
import { audit } from "@/lib/audit";
import { requireAccess } from "@/lib/session";
import { canAccess } from "@/lib/access";
import { todayISO } from "@/lib/dates";
import { validateConsent } from "@/lib/consent";
import { makeDedupeKey } from "@/lib/import/outpatientBoard";
import { patientSearch } from "@/lib/billing/scope";
import { validatePatient } from "@/lib/billing/validate";
import { entryDTO, survivingPatientId } from "@/lib/patients";
import type { EntryDTO } from "@/lib/scheduleTypes";

// Audit details hold record ids and dates only, never patient names or MRNs (PAT-5, CON-3).

export type PatientOption = { id: string; name: string; mrn: string | null };

/** PAT-6: the MRN is shown only to users who already see MRNs in Billing. */
async function option(p: { id: string; lastName: string; firstName: string; mrn: string | null }, showMrn: boolean): Promise<PatientOption> {
  return { id: p.id, name: `${p.lastName}, ${p.firstName}`, mrn: showMrn ? p.mrn : null };
}

export async function searchPatients(q: string): Promise<PatientOption[]> {
  const user = await requireAccess("schedule", "edit");
  const search = patientSearch(typeof q === "string" ? q.slice(0, 100) : "");
  if (!search) return [];
  const rows = await db.billingPatient.findMany({
    where: { AND: [{ mergedIntoId: null }, search] },
    orderBy: [{ lastName: "asc" }, { firstName: "asc" }],
    take: 8,
  });
  const showMrn = canAccess(user, "billing", "view");
  return Promise.all(rows.map((r) => option(r, showMrn)));
}

export async function createPatient(input: { lastName: string; firstName: string; mrn?: string }): Promise<{ ok: true; patient: PatientOption } | { ok: false; errors: Record<string, string> }> {
  const user = await requireAccess("schedule", "edit");
  const { values, errors } = validatePatient(input);
  if (Object.keys(errors).length) return { ok: false, errors };
  if (values.mrn) {
    const onFile = await db.billingPatient.findUnique({ where: { mrn: values.mrn } });
    if (onFile) return { ok: false, errors: { mrn: "A patient with that MRN already exists. Search for them instead." } };
  }
  const created = await db.billingPatient.create({
    data: { mrn: values.mrn || null, lastName: values.lastName, firstName: values.firstName, createdById: user.id },
  });
  await audit(user.email, "patient.create", `patient ${created.id} via schedule`);
  return { ok: true, patient: await option(created, canAccess(user, "billing", "view")) };
}

/** PAT-1, PAT-2: link (or unlink with null) an entry to a patient; linking also sets the visible client text. */
export async function linkPatient(entryId: string, patientId: string | null): Promise<EntryDTO> {
  const user = await requireAccess("schedule", "edit");
  const entry = await db.scheduleEntry.findUnique({ where: { id: entryId } });
  if (!entry) throw new Error("Entry not found");

  if (patientId === null) {
    const updated = await db.scheduleEntry.update({ where: { id: entryId }, data: { patientId: null } });
    await audit(user.email, "schedule.patient.unlink", `entry ${entryId}`);
    revalidatePath("/schedule");
    return entryDTO(updated);
  }

  const resolved = await survivingPatientId(patientId);
  const patient = resolved ? await db.billingPatient.findUnique({ where: { id: resolved } }) : null;
  if (!patient) throw new Error("Patient not found");
  const clientInfo = `${patient.lastName}, ${patient.firstName}`;
  const updated = await db.scheduleEntry.update({
    where: { id: entryId },
    data: {
      patientId: patient.id,
      clientInfo,
      dedupeKey: makeDedupeKey({ date: entry.date, section: entry.section, timeLabel: entry.timeLabel, providerName: entry.providerName, clientInfo }),
    },
  });
  await audit(user.email, "schedule.patient.link", `entry ${entryId} patient ${patient.id}`);
  revalidatePath("/schedule");
  return entryDTO(updated);
}

export type ConsentResult = { ok: true } | { ok: false; errors: Record<string, string> };

/** CON-1 to CON-3, CON-6. At most one active consent per patient, enforced inside a transaction. */
export async function setConsent(patientId: string, input: { consentDate: string; note?: string }): Promise<ConsentResult> {
  const user = await requireAccess("schedule", "edit");
  const { values, errors, ok } = validateConsent(input, todayISO());
  if (!ok) return { ok: false, errors };
  const id = await survivingPatientId(patientId);
  if (!id) return { ok: false, errors: { patient: "Patient not found." } };
  const created = await db.$transaction(async (tx) => {
    const existing = await tx.patientConsent.findFirst({ where: { patientId: id, active: true } });
    if (existing) return null;
    return tx.patientConsent.create({
      data: { patientId: id, consentDate: values.consentDate, note: values.note, confirmedByEmail: user.email },
    });
  });
  if (!created) return { ok: false, errors: { patient: "Consent is already on file for this patient." } };
  await audit(user.email, "consent.set", `patient ${id} consent ${created.id} date ${values.consentDate}`);
  revalidatePath("/schedule");
  return { ok: true };
}

/** CON-5: withdrawal stops new recordings at once and keeps the history. */
export async function withdrawConsent(patientId: string): Promise<ConsentResult> {
  const user = await requireAccess("schedule", "edit");
  const id = await survivingPatientId(patientId);
  if (!id) return { ok: false, errors: { patient: "Patient not found." } };
  const res = await db.patientConsent.updateMany({
    where: { patientId: id, active: true },
    data: { active: false, withdrawnByEmail: user.email, withdrawnAt: new Date() },
  });
  if (res.count === 0) return { ok: false, errors: { patient: "No consent is on file for this patient." } };
  await audit(user.email, "consent.withdraw", `patient ${id}`);
  revalidatePath("/schedule");
  return { ok: true };
}
