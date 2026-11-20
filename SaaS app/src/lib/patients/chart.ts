// Chart basics and admissions. Pure rules, no DB. Dates are YYYY-MM-DD.
export type Stay = { id?: string; admitDate: string; dischargeDate: string | null };

const ISO = /^\d{4}-\d{2}-\d{2}$/;
export function isDate(s: string): boolean {
  if (!ISO.test(s)) return false;
  const d = new Date(`${s}T00:00:00Z`);
  return !Number.isNaN(d.getTime()) && d.toISOString().slice(0, 10) === s;
}

export function cleanBasics(input: { ffxMrn?: string; mrn?: string; dob?: string; sex?: string; insurance?: string }, today: string):
  | { ok: true; value: { ffxMrn: string | null; mrn: string | null; dob: string | null; sex: string | null; insurance: string | null } }
  | { ok: false; error: string } {
  const t = (v?: string, max = 120) => (v ?? "").replace(/\s+/g, " ").trim().slice(0, max);
  const mrn = t(input.mrn, 40).toUpperCase().replace(/\s+/g, "");
  const ffx = t(input.ffxMrn, 40).toUpperCase().replace(/\s+/g, "");
  const dob = t(input.dob, 10);
  if (dob && (!isDate(dob) || dob > today)) return { ok: false, error: "Enter a valid date of birth." };
  const sex = t(input.sex, 20);
  return { ok: true, value: { ffxMrn: ffx || null, mrn: mrn || null, dob: dob || null, sex: sex || null, insurance: t(input.insurance, 200) || null } };
}

/** Error text, or null when this admit date can start a new stay given the existing ones. */
export function checkAdmit(stays: Stay[], admitDate: string): string | null {
  if (!isDate(admitDate)) return "Enter a valid admit date.";
  if (stays.some((s) => s.dischargeDate === null)) return "This patient is already admitted. Discharge them first.";
  const last = stays.map((s) => s.dischargeDate ?? "").sort().pop() ?? "";
  if (last && admitDate < last) return "The admit date is before the last discharge.";
  return null;
}

export function checkDischarge(stay: Stay, dischargeDate: string): string | null {
  if (!isDate(dischargeDate)) return "Enter a valid discharge date.";
  if (stay.dischargeDate !== null) return "That stay is already discharged.";
  if (dischargeDate < stay.admitDate) return "The discharge date is before the admit date.";
  return null;
}
