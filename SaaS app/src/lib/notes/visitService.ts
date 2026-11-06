// Adding, editing and deleting a single visit by hand. Shared by the web Notes board and the recorder's API, so the
// rules live in one place. Audit entries hold ids and counts only, never patient names or note text.

import { db } from "../db";
import { audit } from "../audit";
import { isISODate } from "../dates";
import { validatePatient } from "../billing/validate";
import { apptTimeOf, parseClient } from "./scheduleParse";
import { loadVisitOptions, matchOption } from "./options";
import { isVisitStatus, type VisitStatus } from "./visitStatus";
import { removeScheduleForVisits, syncScheduleForVisit } from "./visitSchedule";

export class VisitError extends Error {
  constructor(public code: "bad_date" | "bad_patient" | "not_found" | "bad_time" | "too_many" | "bad_type" | "bad_provider" | "bad_status", message: string) {
    super(message);
  }
}

export type VisitFields = { apptTime: string; program: string; appointmentType: string; providerName: string };
export type VisitPatch = Partial<VisitFields> & { status?: string };

const text = (v: unknown, max: number): string => (typeof v === "string" ? v.replace(/\s+/g, " ").trim().slice(0, max) : "");

/**
 * A time the provider typed: "2:00", "9:00-11:30", "2:00 PM" or "2 pm". Empty is allowed (no time known).
 * Anything with no clock time in it is refused rather than stored as free text.
 */
export function cleanApptTime(raw: unknown): string {
  const t = text(raw, 40);
  if (!t) return "";
  const parts = t.split(/\s*-\s*/);
  const bad = () => new VisitError("bad_time", "Enter the time like 2:00 PM or 14:00 (minutes 00 to 59).");
  if (parts.length > 2) throw bad();
  return parts.map((p) => oneTime(p) ?? (() => { throw bad(); })()).join("-");
}

/** Same rules as the recorder: 12-hour with AM/PM, 24-hour (14:00 becomes 2:00 PM), or H:MM as typed. A bare number is not a time. */
function oneTime(raw: string): string | null {
  const m = /^(\d{1,2})(?::(\d{2}))?\s*([ap])\.?(m)?\.?$|^(\d{1,2}):(\d{2})$/i.exec(raw.trim());
  if (!m) return null;
  const h = Number(m[1] ?? m[5]);
  const min = Number(m[2] ?? m[6] ?? 0);
  const pad = String(min).padStart(2, "0");
  if (min > 59) return null;
  if (m[3]) return h >= 1 && h <= 12 ? `${h}:${pad} ${m[3].toUpperCase()}M` : null;
  if (h > 23) return null;
  if (h >= 13) return `${h - 12}:${pad} PM`;
  if (h === 0) return `12:${pad} AM`;
  return `${h}:${pad}`;
}

export { apptTimeOf };

/** Type and provider must be one of the listed options (blank is allowed); they are stored with the listed spelling. */
async function cleanFields(input: VisitPatch): Promise<VisitPatch & { status?: VisitStatus }> {
  const out: VisitPatch & { status?: VisitStatus } = {};
  if (input.status !== undefined) {
    if (!isVisitStatus(input.status)) throw new VisitError("bad_status", "Choose a status from the list.");
    out.status = input.status;
  }
  const strict = async () => (input.appointmentType?.trim() || input.providerName?.trim() ? loadVisitOptions() : null);
  const opts = await strict();
  if (input.apptTime !== undefined) out.apptTime = cleanApptTime(input.apptTime);
  if (input.program !== undefined) out.program = text(input.program, 120);
  if (input.appointmentType !== undefined) {
    const t = text(input.appointmentType, 200);
    const hit = t ? matchOption(opts!.appointmentTypes, t) : "";
    if (hit === null) throw new VisitError("bad_type", "Choose an appointment type from the list.");
    out.appointmentType = hit;
  }
  if (input.providerName !== undefined) {
    const t = text(input.providerName, 120);
    const hit = t ? matchOption(opts!.providers, t) : "";
    if (hit === null) throw new VisitError("bad_provider", "Choose a provider from the list.");
    out.providerName = hit;
  }
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

  const fields = await cleanFields(input);
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
      status: fields.status ?? "scheduled",
      createdByEmail: actor.email,
    },
  });
  await syncScheduleForVisit(visit.id);
  await audit(actor.email, "notes.visit.add", `visit ${visit.id} ${input.date}`);
  return visit;
}

export async function updateVisit(actor: { email: string }, id: string, patch: VisitPatch) {
  const existing = await db.visit.findUnique({ where: { id } });
  if (!existing) throw new VisitError("not_found", "Visit not found");
  const data = await cleanFields(patch);
  const visit = await db.visit.update({ where: { id }, data });
  await syncScheduleForVisit(id);
  await audit(actor.email, "notes.visit.update", `visit ${id} fields=${Object.keys(data).join(",")}`);
  return visit;
}

/** Deletes the visit with its transcript and generated documents (their versions go with them). */
export async function deleteVisit(actor: { email: string }, id: string) {
  const existing = await db.visit.findUnique({ where: { id }, include: { documents: { select: { id: true } } } });
  if (!existing) throw new VisitError("not_found", "Visit not found");
  await db.visit.delete({ where: { id } });
  await removeScheduleForVisits([id]);
  await audit(actor.email, "notes.visit.delete", `visit ${id} ${existing.visitDate} documents=${existing.documents.length}`);
}

export const MAX_BULK_DELETE = 200;

/**
 * Deletes several visits at once (transcripts and documents go with them). Ids that do not exist are reported, not
 * errors. The audit entry holds counts only.
 */
export async function deleteVisits(actor: { email: string }, ids: string[]): Promise<{ deleted: string[]; notFound: string[] }> {
  const unique = [...new Set(ids)];
  if (unique.length === 0) return { deleted: [], notFound: [] };
  if (unique.length > MAX_BULK_DELETE) throw new VisitError("too_many", `Delete at most ${MAX_BULK_DELETE} visits at a time.`);
  const found = await db.visit.findMany({ where: { id: { in: unique } }, select: { id: true, _count: { select: { documents: true } } } });
  const foundIds = found.map((v) => v.id);
  if (foundIds.length) await db.visit.deleteMany({ where: { id: { in: foundIds } } });
  await removeScheduleForVisits(foundIds);
  const documents = found.reduce((n, v) => n + v._count.documents, 0);
  await audit(actor.email, "notes.visit.bulkDelete", `visits=${foundIds.length} notFound=${unique.length - foundIds.length} documents=${documents}`);
  return { deleted: foundIds, notFound: unique.filter((i) => !foundIds.includes(i)) };
}
