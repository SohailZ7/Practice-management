// Adding, editing and deleting a single visit by hand. Shared by the web Notes board and the recorder's API, so the
// rules live in one place. Audit entries hold ids and counts only, never patient names or note text.

import { db } from "../db";
import { audit } from "../audit";
import { isISODate } from "../dates";
import { validatePatient } from "../billing/validate";
import { apptTimeOf, parseClient } from "./scheduleParse";

export class VisitError extends Error {
  constructor(public code: "bad_date" | "bad_patient" | "not_found" | "bad_time", message: string) {
    super(message);
  }
}

export type VisitFields = { apptTime: string; program: string; appointmentType: string; providerName: string };
export type VisitPatch = Partial<VisitFields>;

const text = (v: unknown, max: number): string => (typeof v === "string" ? v.replace(/\s+/g, " ").trim().slice(0, max) : "");

/**
 * A time the provider typed: "2:00", "9:00-11:30", "2:00 PM" or "2 pm". Empty is allowed (no time known).
 * Anything with no clock time in it is refused rather than stored as free text.
 */
export function cleanApptTime(raw: unknown): string {
  const t = text(raw, 40);
  if (!t) return "";
  if (/^\d{1,2}\s*([ap]\.?m\.?)$/i.test(t)) return t.replace(/\s+/g, " ").toUpperCase().replace(/\./g, "");
  const m = /^(\d{1,2}:\d{2})(\s*[ap]\.?m\.?)?(?:\s*-\s*(\d{1,2}:\d{2})(\s*[ap]\.?m\.?)?)?$/i.exec(t);
  if (!m) throw new VisitError("bad_time", "Enter the time like 2:00 PM or 9:00-11:30.");
  const mer = (x?: string) => (x ? ` ${x.replace(/[\s.]/g, "").toUpperCase()}` : "");
  return m[3] ? `${m[1]}${mer(m[2])}-${m[3]}${mer(m[4])}` : `${m[1]}${mer(m[2])}`;
}

export { apptTimeOf };

function cleanFields(input: VisitPatch): VisitPatch {
  const out: VisitPatch = {};
  if (input.apptTime !== undefined) out.apptTime = cleanApptTime(input.apptTime);
  if (input.program !== undefined) out.program = text(input.program, 120);
  if (input.appointmentType !== undefined) out.appointmentType = text(input.appointmentType, 200);
  if (input.providerName !== undefined) out.providerName = text(input.providerName, 120);
  return out;
}

/** Adds one visit for a day. `patient` is the name as typed: "First Last" or "Last, First". Finds or creates the patient. */
export async function addVisit(
  actor: { id: string; email: string },
  input: { date: string; patient: string } & VisitPatch,
) {
  if (!isISODate(input.date)) throw new VisitError("bad_date", "Invalid date");
  const parsed = parseClient(text(input.patient, 200));
  if (!parsed) throw new VisitError("bad_patient", "Enter the patient's name.");
  const { values, errors } = validatePatient({ lastName: parsed.lastName, firstName: parsed.firstName });
  if (Object.keys(errors).length) throw new VisitError("bad_patient", Object.values(errors)[0] ?? "Enter the patient's name.");

  const fields = cleanFields(input);
  const patient =
    (await db.billingPatient.findFirst({ where: { lastName: values.lastName, firstName: values.firstName, mergedIntoId: null } })) ??
    (await db.billingPatient.create({ data: { lastName: values.lastName, firstName: values.firstName, createdById: actor.id } }));

  const visit = await db.visit.create({
    data: {
      patientId: patient.id,
      visitDate: input.date,
      apptTime: fields.apptTime ?? "",
      program: fields.program ?? "",
      appointmentType: fields.appointmentType ?? "",
      providerName: fields.providerName ?? "",
      createdByEmail: actor.email,
    },
  });
  await audit(actor.email, "notes.visit.add", `visit ${visit.id} ${input.date}`);
  return visit;
}

export async function updateVisit(actor: { email: string }, id: string, patch: VisitPatch) {
  const existing = await db.visit.findUnique({ where: { id } });
  if (!existing) throw new VisitError("not_found", "Visit not found");
  const data = cleanFields(patch);
  const visit = await db.visit.update({ where: { id }, data });
  await audit(actor.email, "notes.visit.update", `visit ${id} fields=${Object.keys(data).join(",")}`);
  return visit;
}

/** Deletes the visit with its transcript and generated documents (their versions go with them). */
export async function deleteVisit(actor: { email: string }, id: string) {
  const existing = await db.visit.findUnique({ where: { id }, include: { documents: { select: { id: true } } } });
  if (!existing) throw new VisitError("not_found", "Visit not found");
  await db.visit.delete({ where: { id } });
  await audit(actor.email, "notes.visit.delete", `visit ${id} ${existing.visitDate} documents=${existing.documents.length}`);
}
