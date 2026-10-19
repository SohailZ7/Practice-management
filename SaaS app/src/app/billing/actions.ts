"use server";

import { revalidatePath } from "next/cache";
import { db } from "@/lib/db";
import { audit } from "@/lib/audit";
import { auditDenied, requireAccess, requireAdmin } from "@/lib/session";
import { recordHistory } from "@/lib/billing/history";
import { canChangeEncounter, getixBlocker } from "@/lib/billing/rules";
import { patientScope, patientSearch } from "@/lib/billing/scope";
import {
  cleanName,
  sameName,
  str,
  validateEncounter,
  validateMrn,
  validatePatient,
} from "@/lib/billing/validate";
import { queryEncounters, queryPatients } from "@/lib/billing/queries";
import type {
  EncounterFilters,
  EncounterFormInput,
  EncounterRow,
  PatientFilters,
  PatientHit,
  PatientRow,
  SaveResult,
} from "@/lib/billing/types";

// Audit entries hold record ids only, never patient names, MRNs or codes.

const fail = (errors: Record<string, string>): SaveResult => ({ ok: false, errors });

async function allowedPrograms(currentProgramId?: string): Promise<string[]> {
  const rows = await db.program.findMany({ where: { OR: [{ active: true }, { id: currentProgramId ?? "" }] } });
  return rows.map((p) => p.id);
}

export async function saveEncounter(input: EncounterFormInput): Promise<SaveResult> {
  const user = await requireAccess("billing", "edit");

  // ---- Editing an existing encounter: only the encounter fields change.
  if (input.encounterId) {
    const existing = await db.encounter.findUnique({ where: { id: input.encounterId } });
    if (!existing) return fail({ form: "Encounter not found." });
    if (!canChangeEncounter(user, existing)) {
      await auditDenied(user.email, `edit encounter ${existing.id}`);
      return fail({ form: "This encounter can't be changed (not yours, locked in GetIX, or deleted)." });
    }
    const { values, errors } = validateEncounter(input, await allowedPrograms(existing.programId));
    if (Object.keys(errors).length) return fail(errors);
    await db.$transaction(async (tx) => {
      await recordHistory(tx, "encounter", existing.id, "edit", existing, user.id);
      await tx.encounter.update({
        where: { id: existing.id },
        data: {
          encounterDate: values.encounterDate,
          programId: values.programId,
          icd10Codes: values.icd10Codes,
          chargeCode: values.chargeCode,
          note: values.note,
          updatedById: user.id,
          updatedAt: new Date(),
        },
      });
    });
    await audit(user.email, "billing.encounter.edit", `encounter ${existing.id}`);
    revalidatePath("/billing", "layout");
    return { ok: true, encounterId: existing.id, patientId: existing.patientId };
  }

  // ---- New encounter.
  const enc = validateEncounter(input, await allowedPrograms());
  const errors = { ...enc.errors };

  let patientId: string | null = null;
  let newPatient: { mrn: string | null; lastName: string; firstName: string } | null = null;

  if (input.patientId) {
    const visible = await db.billingPatient.findFirst({ where: { id: input.patientId, ...patientScope(user) } });
    if (!visible) errors.patient = "Choose a patient from the list.";
    else patientId = visible.id;
  } else {
    const p = validatePatient(input);
    Object.assign(errors, p.errors);
    if (Object.keys(errors).length) return fail(errors);

    const { mrn, lastName, firstName } = p.values;
    if (mrn) {
      const onFile = await db.billingPatient.findUnique({ where: { mrn } });
      if (onFile) {
        if (!sameName(onFile.lastName, lastName) || !sameName(onFile.firstName, firstName)) {
          return fail({
            mrn: "That MRN is on file under a different name. Check the MRN and the name, then try again.",
          });
        }
        patientId = onFile.id;
      } else {
        newPatient = { mrn, lastName, firstName };
      }
    } else {
      // No MRN: ask before creating a second record for the same name.
      const sameNamed = await db.billingPatient.findMany({
        where: {
          ...patientScope(user),
          lastName: { equals: lastName, mode: "insensitive" },
          firstName: { equals: firstName, mode: "insensitive" },
        },
        take: 1,
      });
      const match = sameNamed[0];
      if (match && !input.confirm) {
        return {
          ok: false,
          errors: {},
          confirm: { patientId: match.id, name: `${match.lastName}, ${match.firstName}${match.mrn ? ` (MRN ${match.mrn})` : ""}` },
        };
      }
      if (match && input.confirm === match.id) patientId = match.id;
      else newPatient = { mrn: null, lastName, firstName };
    }
  }

  if (Object.keys(errors).length) return fail(errors);

  const result = await db.$transaction(async (tx) => {
    let pid = patientId;
    if (!pid && newPatient) {
      const created = await tx.billingPatient.create({ data: { ...newPatient, createdById: user.id } });
      pid = created.id;
    }
    const encounter = await tx.encounter.create({
      data: {
        patientId: pid!,
        encounterDate: enc.values.encounterDate,
        programId: enc.values.programId,
        icd10Codes: enc.values.icd10Codes,
        chargeCode: enc.values.chargeCode,
        note: enc.values.note,
        createdById: user.id,
      },
    });
    return { encounterId: encounter.id, patientId: pid! };
  });
  await audit(user.email, "billing.encounter.create", `encounter ${result.encounterId} patient ${result.patientId}`);
  revalidatePath("/billing", "layout");
  return { ok: true, ...result };
}

export async function deleteEncounter(id: string): Promise<{ error?: string }> {
  const user = await requireAccess("billing", "edit");
  const existing = await db.encounter.findUnique({ where: { id } });
  if (!existing) return { error: "Encounter not found." };
  if (!canChangeEncounter(user, existing)) {
    await auditDenied(user.email, `delete encounter ${id}`);
    return { error: "This encounter can't be deleted (not yours, locked in GetIX, or already deleted)." };
  }
  await db.$transaction(async (tx) => {
    await recordHistory(tx, "encounter", id, "delete", existing, user.id);
    await tx.encounter.update({ where: { id }, data: { deletedAt: new Date(), deletedById: user.id } });
  });
  await audit(user.email, "billing.encounter.delete", `encounter ${id}`);
  revalidatePath("/billing", "layout");
  return {};
}

export async function restoreEncounter(id: string): Promise<{ error?: string }> {
  const admin = await requireAdmin();
  const existing = await db.encounter.findUnique({ where: { id } });
  if (!existing || !existing.deletedAt) return { error: "That encounter isn't deleted." };
  await db.$transaction(async (tx) => {
    await recordHistory(tx, "encounter", id, "restore", existing, admin.id);
    await tx.encounter.update({ where: { id }, data: { deletedAt: null, deletedById: null } });
  });
  await audit(admin.email, "billing.encounter.restore", `encounter ${id}`);
  revalidatePath("/billing", "layout");
  return {};
}

/** BIL-11: only the Admin marks or unmarks "Entered into GetIX"; marking needs an MRN and locks the encounter. */
export async function setGetix(id: string, entered: boolean): Promise<{ error?: string }> {
  const admin = await requireAdmin();
  const existing = await db.encounter.findUnique({ where: { id }, include: { patient: true } });
  if (!existing) return { error: "Encounter not found." };
  if (entered) {
    const blocker = getixBlocker(existing.patient, existing);
    if (blocker) return { error: blocker };
    if (existing.getixEntered) return {};
  } else if (!existing.getixEntered) {
    return {};
  }
  const { patient: _patient, ...snapshot } = existing;
  void _patient;
  await db.$transaction(async (tx) => {
    await recordHistory(tx, "encounter", id, entered ? "mark_getix" : "unmark_getix", snapshot, admin.id);
    await tx.encounter.update({
      where: { id },
      data: entered
        ? { getixEntered: true, getixEnteredAt: new Date(), getixEnteredById: admin.id }
        : { getixEntered: false, getixEnteredAt: null, getixEnteredById: null },
    });
  });
  await audit(admin.email, entered ? "billing.getix.mark" : "billing.getix.unmark", `encounter ${id}`);
  revalidatePath("/billing", "layout");
  return {};
}

export async function searchPatients(q: string): Promise<PatientHit[]> {
  const user = await requireAccess("billing", "edit");
  const filter = patientSearch(str(q).slice(0, 100));
  if (!filter) return [];
  const rows = await db.billingPatient.findMany({
    where: { AND: [patientScope(user), filter] },
    orderBy: [{ lastName: "asc" }, { firstName: "asc" }],
    take: 15,
  });
  await audit(user.email, "billing.patients.search", `${rows.length} result(s)`);
  return rows.map((p) => ({ id: p.id, mrn: p.mrn, name: `${p.lastName}, ${p.firstName}` }));
}

// ---------------- Admin: patients ----------------

export type PatientAdminResult =
  | { ok: true }
  | { ok: false; error: string; merge?: { keepId: string; keepName: string } };

export async function addMrn(patientId: string, rawMrn: string): Promise<PatientAdminResult> {
  const admin = await requireAdmin();
  const { mrn, error } = validateMrn(rawMrn);
  if (error) return { ok: false, error };
  const patient = await db.billingPatient.findUnique({ where: { id: patientId } });
  if (!patient || patient.mergedIntoId) return { ok: false, error: "Patient not found." };
  if (patient.mrn) return { ok: false, error: "This patient already has an MRN. Use “Fix name or MRN”." };

  const other = await db.billingPatient.findUnique({ where: { mrn } });
  if (other && other.id !== patient.id) {
    if (sameName(other.lastName, patient.lastName) && sameName(other.firstName, patient.firstName)) {
      return {
        ok: false,
        error: "That MRN already belongs to another record for the same person.",
        merge: { keepId: other.id, keepName: `${other.lastName}, ${other.firstName}` },
      };
    }
    return { ok: false, error: "That MRN is on file under a different name." };
  }
  await db.$transaction(async (tx) => {
    await recordHistory(tx, "patient", patient.id, "add_mrn", patient, admin.id);
    await tx.billingPatient.update({ where: { id: patient.id }, data: { mrn } });
  });
  await audit(admin.email, "billing.patient.add_mrn", `patient ${patient.id}`);
  revalidatePath("/billing", "layout");
  return { ok: true };
}

export async function fixPatient(
  patientId: string,
  input: { mrn: string; lastName: string; firstName: string },
): Promise<PatientAdminResult> {
  const admin = await requireAdmin();
  const { values, errors } = validatePatient(input);
  const first = Object.values(errors)[0];
  if (first) return { ok: false, error: first };
  const patient = await db.billingPatient.findUnique({ where: { id: patientId } });
  if (!patient || patient.mergedIntoId) return { ok: false, error: "Patient not found." };
  if (values.mrn) {
    const other = await db.billingPatient.findUnique({ where: { mrn: values.mrn } });
    if (other && other.id !== patient.id) return { ok: false, error: "Another record already has that MRN." };
  }
  await db.$transaction(async (tx) => {
    await recordHistory(tx, "patient", patient.id, "fix", patient, admin.id);
    await tx.billingPatient.update({
      where: { id: patient.id },
      data: { mrn: values.mrn || null, lastName: values.lastName, firstName: values.firstName },
    });
  });
  await audit(admin.email, "billing.patient.fix", `patient ${patient.id}`);
  revalidatePath("/billing", "layout");
  return { ok: true };
}

/** Moves every encounter to `keepId`; the other record is kept as merged, not erased. */
export async function mergePatients(keepId: string, removeId: string): Promise<PatientAdminResult> {
  const admin = await requireAdmin();
  if (keepId === removeId) return { ok: false, error: "Choose two different records." };
  const [keep, remove] = await Promise.all([
    db.billingPatient.findUnique({ where: { id: keepId } }),
    db.billingPatient.findUnique({ where: { id: removeId } }),
  ]);
  if (!keep || !remove || keep.mergedIntoId || remove.mergedIntoId) return { ok: false, error: "Patient not found." };
  if (!sameName(keep.lastName, remove.lastName) || !sameName(keep.firstName, remove.firstName)) {
    return { ok: false, error: "Only records with the same name can be merged." };
  }
  await db.$transaction(async (tx) => {
    const moving = await tx.encounter.findMany({ where: { patientId: remove.id } });
    for (const e of moving) await recordHistory(tx, "encounter", e.id, "merge_move", e, admin.id);
    await recordHistory(tx, "patient", remove.id, "merge", remove, admin.id);
    await tx.encounter.updateMany({ where: { patientId: remove.id }, data: { patientId: keep.id } });
    await tx.billingPatient.update({ where: { id: remove.id }, data: { mrn: null, mergedIntoId: keep.id } });
  });
  await audit(admin.email, "billing.patient.merge", `patient ${remove.id} into ${keep.id}`);
  revalidatePath("/billing", "layout");
  return { ok: true };
}

// ---------------- Admin: programs ----------------

export async function addProgram(rawName: string): Promise<{ error?: string }> {
  const admin = await requireAdmin();
  const name = cleanName(rawName).slice(0, 80);
  if (!name) return { error: "Enter a program name." };
  const clash = await db.program.findFirst({ where: { name: { equals: name, mode: "insensitive" } } });
  if (clash) return { error: "That program already exists." };
  const p = await db.program.create({ data: { name } });
  await audit(admin.email, "billing.program.add", `program ${p.id}`);
  revalidatePath("/billing", "layout");
  return {};
}

export async function renameProgram(id: string, rawName: string): Promise<{ error?: string }> {
  const admin = await requireAdmin();
  const name = cleanName(rawName).slice(0, 80);
  if (!name) return { error: "Program name can't be blank." };
  const clash = await db.program.findFirst({ where: { name: { equals: name, mode: "insensitive" }, NOT: { id } } });
  if (clash) return { error: "That program already exists." };
  await db.program.update({ where: { id }, data: { name } });
  await audit(admin.email, "billing.program.rename", `program ${id}`);
  revalidatePath("/billing", "layout");
  return {};
}

export async function setProgramActive(id: string, active: boolean): Promise<{ error?: string }> {
  const admin = await requireAdmin();
  await db.program.update({ where: { id }, data: { active } });
  await audit(admin.email, active ? "billing.program.activate" : "billing.program.deactivate", `program ${id}`);
  revalidatePath("/billing", "layout");
  return {};
}


/** Counts and which filters were used, never the search text (it can be a patient name). */
function listDetail(count: number, filters: object): string {
  const used = Object.entries(filters).filter(([, v]) => v !== "" && v !== "all" && v !== "any").map(([k]) => k);
  return `${count} row(s)${used.length ? ` filters=${used.join(",")}` : ""}`;
}

// ---------------- Lists (filters never go in the URL, so patient names stay out of it) ----------------

export async function listEncounters(filters: EncounterFilters): Promise<EncounterRow[]> {
  const user = await requireAccess("billing", "view");
  const rows = await queryEncounters(user, filters);
  await audit(user.email, "billing.encounters.list", listDetail(rows.length, filters));
  return rows;
}

export async function listPatients(filters: PatientFilters): Promise<PatientRow[]> {
  const user = await requireAccess("billing", "view");
  const rows = await queryPatients(user, filters);
  await audit(user.email, "billing.patients.list", listDetail(rows.length, filters));
  return rows;
}
