// Set and withdraw AI-documentation consent. Shared by the web schedule actions and the Desktop API so both follow the
// same rules (requirements v19, CON-1 to CON-6). Audit details hold ids and dates only, never names.
import { db } from "./db";
import { audit } from "./audit";
import { todayISO } from "./dates";
import { validateConsent } from "./consent";
import { survivingPatientId } from "./patients";

export type ConsentResult = { ok: true } | { ok: false; errors: Record<string, string> };

export async function setPatientConsent(actorEmail: string, patientId: string, input: { consentDate?: unknown; note?: unknown }): Promise<ConsentResult> {
  const { values, errors, ok } = validateConsent(input, todayISO());
  if (!ok) return { ok: false, errors };
  const id = await survivingPatientId(patientId);
  if (!id) return { ok: false, errors: { patient: "Patient not found." } };
  const created = await db.$transaction(async (tx) => {
    const existing = await tx.patientConsent.findFirst({ where: { patientId: id, active: true } });
    if (existing) return null;
    return tx.patientConsent.create({ data: { patientId: id, consentDate: values.consentDate, note: values.note, confirmedByEmail: actorEmail } });
  });
  if (!created) return { ok: false, errors: { patient: "Consent is already on file for this patient." } };
  await audit(actorEmail, "consent.set", `patient ${id} consent ${created.id} date ${values.consentDate}`);
  return { ok: true };
}

export async function withdrawPatientConsent(actorEmail: string, patientId: string): Promise<ConsentResult> {
  const id = await survivingPatientId(patientId);
  if (!id) return { ok: false, errors: { patient: "Patient not found." } };
  const res = await db.patientConsent.updateMany({
    where: { patientId: id, active: true },
    data: { active: false, withdrawnByEmail: actorEmail, withdrawnAt: new Date() },
  });
  if (res.count === 0) return { ok: false, errors: { patient: "No consent is on file for this patient." } };
  await audit(actorEmail, "consent.withdraw", `patient ${id}`);
  return { ok: true };
}

/** The active consent for a patient, or null. */
export async function activeConsent(patientId: string) {
  const id = await survivingPatientId(patientId);
  if (!id) return null;
  return db.patientConsent.findFirst({ where: { patientId: id, active: true } });
}
