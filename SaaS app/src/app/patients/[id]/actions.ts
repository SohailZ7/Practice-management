"use server";

import { revalidatePath } from "next/cache";
import { db } from "@/lib/db";
import { audit } from "@/lib/audit";
import { requireAccess } from "@/lib/session";
import { canAccess } from "@/lib/access";
import { flash, str } from "@/lib/flash";
import { cleanBasics, checkAdmit, checkDischarge } from "@/lib/patients/chart";

// Audit entries hold record ids and field names only, never names, MRNs, dates of birth or insurance text.
const back = (id: string) => `/patients/${id}`;
const today = () => new Date().toISOString().slice(0, 10);

export async function saveBasics(form: FormData) {
  const user = await requireAccess("notes", "edit");
  const id = str(form, "id");
  const patient = await db.patient.findFirst({ where: { id, mergedIntoId: null } });
  if (!patient) flash("/patients", "error", "Patient not found.");
  const mrnAllowed = canAccess(user, "billing", "view");
  const r = cleanBasics(
    { dob: str(form, "dob"), sex: str(form, "sex"), insurance: str(form, "insurance"), accountNo: str(form, "accountNo"), allergies: str(form, "allergies"), mrn: mrnAllowed ? str(form, "mrn") : "", ffxMrn: mrnAllowed ? str(form, "ffxMrn") : "" },
    today(),
  );
  if (!r.ok) flash(back(id), "error", r.error);
  else {
    const v = r.value;
    if (mrnAllowed && v.mrn && v.mrn !== patient!.mrn && (await db.patient.findUnique({ where: { mrn: v.mrn } }))) {
      flash(back(id), "error", "Another patient already has that MRN.");
    }
    await db.patient.update({
      where: { id },
      data: { dob: v.dob, sex: v.sex, insurance: v.insurance, accountNo: v.accountNo, allergies: v.allergies, ...(mrnAllowed ? { mrn: v.mrn, ffxMrn: v.ffxMrn } : {}) },
    });
    await audit(user.email, "patient.basics.update", `patient ${id} fields=dob,sex,insurance,accountNo,allergies${mrnAllowed ? ",mrn,ffxMrn" : ""}`);
    revalidatePath(back(id));
    flash(back(id), "notice", "Chart basics saved.");
  }
}

export async function admitPatient(form: FormData) {
  const user = await requireAccess("notes", "edit");
  const id = str(form, "id");
  const admitDate = str(form, "admitDate") || today();
  if (!(await db.patient.findFirst({ where: { id, mergedIntoId: null }, select: { id: true } }))) flash("/patients", "error", "Patient not found.");
  const stays = await db.patientAdmission.findMany({ where: { patientId: id }, select: { admitDate: true, dischargeDate: true } });
  const err = checkAdmit(stays, admitDate);
  if (err) flash(back(id), "error", err);
  const created = await db.patientAdmission.create({ data: { patientId: id, admitDate, createdByEmail: user.email } });
  await audit(user.email, stays.length ? "patient.readmit" : "patient.admit", `patient ${id} stay ${created.id}`);
  revalidatePath(back(id));
  flash(back(id), "notice", stays.length ? "Readmitted. Earlier stays are kept." : "Admitted.");
}

export async function dischargePatient(form: FormData) {
  const user = await requireAccess("notes", "edit");
  const id = str(form, "id");
  const stayId = str(form, "stayId");
  const dischargeDate = str(form, "dischargeDate") || today();
  const stay = await db.patientAdmission.findFirst({ where: { id: stayId, patientId: id } });
  if (!stay) flash(back(id), "error", "Stay not found.");
  const err = checkDischarge(stay!, dischargeDate);
  if (err) flash(back(id), "error", err);
  await db.patientAdmission.update({ where: { id: stayId }, data: { dischargeDate } });
  await audit(user.email, "patient.discharge", `patient ${id} stay ${stayId}`);
  revalidatePath(back(id));
  flash(back(id), "notice", "Discharged.");
}
