import { parseIcd10List } from "./icd10";
import { isISODate } from "../dates";

export const MAX_CODES = 25;
const MRN_SHAPE = /^[A-Z0-9-]{1,30}$/;
const NAME_SHAPE = /^[\p{L}\p{M}][\p{L}\p{M}' .-]{0,99}$/u;
const CHARGE_SHAPE = /^[A-Z0-9][A-Z0-9 .,-]{0,29}$/;

export const str = (value: unknown): string => (typeof value === "string" ? value.trim() : "");
export const cleanMrn = (value: unknown): string => str(value).toUpperCase().replace(/\s+/g, "");
export const cleanName = (value: unknown): string => str(value).replace(/\s+/g, " ");
export const sameName = (a: string, b: string): boolean => cleanName(a).toLowerCase() === cleanName(b).toLowerCase();

/** Today's date in the practice's time zone, as YYYY-MM-DD. */
export function todayInPractice(now = new Date(), timeZone = process.env.PRACTICE_TIMEZONE || "America/Los_Angeles"): string {
  return new Intl.DateTimeFormat("en-CA", { timeZone, year: "numeric", month: "2-digit", day: "2-digit" }).format(now);
}

export type Errors = Record<string, string>;

function checkName(value: string, label: string): string | null {
  if (!value) return `Enter the ${label}.`;
  if (!NAME_SHAPE.test(value)) return `Use letters, spaces, hyphens, apostrophes or periods for the ${label} (100 at most).`;
  return null;
}

export function validatePatient(body: { mrn?: unknown; lastName?: unknown; firstName?: unknown }) {
  const values = { mrn: cleanMrn(body.mrn), lastName: cleanName(body.lastName), firstName: cleanName(body.firstName) };
  const errors: Errors = {};
  // The MRN is optional: an admin can add it later, while billing.
  if (values.mrn && !MRN_SHAPE.test(values.mrn)) errors.mrn = "Use only letters, numbers and dashes for the MRN (30 at most).";
  const last = checkName(values.lastName, "last name");
  if (last) errors.lastName = last;
  const first = checkName(values.firstName, "first name");
  if (first) errors.firstName = first;
  return { values, errors };
}

export function validateMrn(raw: unknown): { mrn: string; error?: string } {
  const mrn = cleanMrn(raw);
  if (!mrn) return { mrn, error: "Enter the MRN." };
  if (!MRN_SHAPE.test(mrn)) return { mrn, error: "Use only letters, numbers and dashes for the MRN (30 at most)." };
  return { mrn };
}

export type EncounterInput = {
  encounterDate?: unknown;
  programId?: unknown;
  icd10Input?: unknown;
  chargeCode?: unknown;
  note?: unknown;
};

/** allowedProgramIds: active programs, plus the encounter's current program when editing. */
export function validateEncounter(body: EncounterInput, allowedProgramIds: string[], today = todayInPractice()) {
  const typedCodes = str(body.icd10Input).slice(0, 500);
  const { codes, invalid } = parseIcd10List(typedCodes);
  const values = {
    encounterDate: str(body.encounterDate),
    programId: str(body.programId),
    icd10Codes: codes,
    chargeCode: str(body.chargeCode).toUpperCase(),
    note: str(body.note),
  };
  const errors: Errors = {};

  if (!values.encounterDate) errors.encounterDate = "Enter the encounter date.";
  else if (!isISODate(values.encounterDate)) errors.encounterDate = "Enter a real date.";
  else if (values.encounterDate > today) errors.encounterDate = "The encounter date can't be in the future.";

  if (!allowedProgramIds.includes(values.programId)) errors.programId = "Choose a program.";

  if (invalid.length) errors.icd10Codes = `Not shaped like an ICD-10 code: ${invalid.join(", ")}. Codes look like E11.9 or I10.`;
  else if (!codes.length) errors.icd10Codes = "Enter at least one ICD-10 code.";
  else if (codes.length > MAX_CODES) errors.icd10Codes = `Enter ${MAX_CODES} codes or fewer.`;

  if (values.chargeCode && !CHARGE_SHAPE.test(values.chargeCode)) {
    errors.chargeCode = "Use letters, numbers, spaces, dashes, commas or periods for the charge code (30 at most).";
  }
  if (values.note.length > 1000) errors.note = "Keep the note to 1,000 characters or fewer.";
  if (!values.chargeCode && !values.note) errors.chargeCode = "Enter a charge code, a note, or both.";

  return { values, errors };
}
