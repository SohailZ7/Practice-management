import type { Prisma } from "@prisma/client";
import { db } from "../db";
import { canChangeEncounter, isAdmin, type Actor } from "./rules";
import { patientScope, patientSearch } from "./scope";
import type { EncounterFilters, EncounterRow, PatientFilters, PatientRow } from "./types";

const LIMIT = 300;

export async function userNames(ids: string[]): Promise<Map<string, string>> {
  const users = await db.user.findMany({ where: { id: { in: [...new Set(ids)] } }, select: { id: true, name: true } });
  return new Map(users.map((u) => [u.id, u.name]));
}

export function defaultEncounterFilters(user: Actor): EncounterFilters {
  // The admin's worklist opens on encounters not yet in GetIX.
  return { q: "", from: "", to: "", programId: "", status: isAdmin(user) ? "pending" : "all", mrn: "any", by: "", show: "active" };
}

export async function queryEncounters(user: Actor, f: EncounterFilters): Promise<EncounterRow[]> {
  const admin = isAdmin(user);
  const and: Prisma.EncounterWhereInput[] = [];
  // Providers see the encounters they entered; the whole record of a patient is on the patient page.
  if (!admin) and.push({ createdById: user.id });
  and.push(admin && f.show === "deleted" ? { deletedAt: { not: null } } : { deletedAt: null });
  if (f.from) and.push({ encounterDate: { gte: f.from } });
  if (f.to) and.push({ encounterDate: { lte: f.to } });
  if (f.programId) and.push({ programId: f.programId });
  if (f.status === "pending") and.push({ getixEntered: false });
  if (f.status === "entered") and.push({ getixEntered: true });
  if (f.mrn === "missing") and.push({ patient: { mrn: null } });
  if (admin && f.by) and.push({ createdById: f.by });
  const search = patientSearch(f.q);
  if (search) and.push({ patient: search });

  const rows = await db.encounter.findMany({
    where: { AND: and },
    include: { patient: true, program: true },
    orderBy: [{ encounterDate: f.status === "pending" ? "asc" : "desc" }, { createdAt: "asc" }],
    take: LIMIT,
  });
  const names = await userNames(rows.map((r) => r.createdById));
  return rows.map((e) => ({
    id: e.id,
    date: e.encounterDate,
    patientId: e.patientId,
    patientName: `${e.patient.lastName}, ${e.patient.firstName}`,
    mrn: e.patient.mrn,
    program: e.program.name,
    icd10Codes: e.icd10Codes,
    chargeCode: e.chargeCode,
    note: e.note,
    enteredBy: names.get(e.createdById) ?? "",
    getixEntered: e.getixEntered,
    getixEnteredAt: e.getixEnteredAt ? e.getixEnteredAt.toISOString().slice(0, 10) : null,
    deleted: e.deletedAt !== null,
    canChange: canChangeEncounter(user, e),
  }));
}

export const defaultPatientFilters = (): PatientFilters => ({
  q: "",
  from: "",
  to: "",
  programId: "",
  waiting: false,
  mrn: "any",
  by: "",
});

export async function queryPatients(user: Actor, f: PatientFilters): Promise<PatientRow[]> {
  const admin = isAdmin(user);
  const encFilter: Prisma.EncounterWhereInput = { deletedAt: null };
  if (f.from) encFilter.encounterDate = { ...(encFilter.encounterDate as object), gte: f.from };
  if (f.to) encFilter.encounterDate = { ...(encFilter.encounterDate as object), lte: f.to };
  if (f.programId) encFilter.programId = f.programId;
  if (f.waiting) encFilter.getixEntered = false;
  if (admin && f.by) encFilter.createdById = f.by;
  const narrowed = Boolean(f.from || f.to || f.programId || f.waiting || (admin && f.by));

  const and: Prisma.BillingPatientWhereInput[] = [patientScope(user)];
  const search = patientSearch(f.q);
  if (search) and.push(search);
  if (f.mrn === "missing") and.push({ mrn: null });
  if (narrowed) and.push({ encounters: { some: encFilter } });

  const patients = await db.billingPatient.findMany({
    where: { AND: and },
    include: { encounters: { where: { deletedAt: null }, select: { encounterDate: true, getixEntered: true } } },
    orderBy: [{ lastName: "asc" }, { firstName: "asc" }],
    take: LIMIT,
  });
  return patients.map((p) => ({
    id: p.id,
    mrn: p.mrn,
    name: `${p.lastName}, ${p.firstName}`,
    lastSeen: p.encounters.reduce((max, e) => (e.encounterDate > max ? e.encounterDate : max), ""),
    encounters: p.encounters.length,
    waiting: p.encounters.filter((e) => !e.getixEntered).length,
  }));
}
