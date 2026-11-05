// Template-based documents: which types exist, which template file each uses, and the field schema read from it.
//
// The schema of a fillable PDF is its AcroForm fields. A checkbox with a single widget is a 'checkbox'; several
// checkboxes that share one field name (Program: IOP / PHP) are mutually exclusive and become a 'select' whose options
// are the widget export values. Psych Eval has no form fields, so it uses a fixed section list of long texts.

import fs from "node:fs";
import path from "node:path";
import { PDFCheckBox, PDFDocument, PDFSignature, PDFTextField } from "pdf-lib";
import { documentsFor, type DocKind } from "./documents";

export type FieldType = "text" | "longtext" | "checkbox" | "select" | "date";
export type DocField = { name: string; label: string; type: FieldType; options?: string[] };
export type FieldValue = string | boolean;
export type DocValues = Record<string, FieldValue>;

export type DocTypeId = "progress_note" | "psych_eval" | "admit_order" | "discharge_order";

export const DOC_TYPES: { id: DocTypeId; label: string }[] = [
  { id: "progress_note", label: "Progress Note" },
  { id: "psych_eval", label: "Psych Eval" },
  { id: "admit_order", label: "Admit Order" },
  { id: "discharge_order", label: "Discharge Order" },
];
export const isDocType = (v: unknown): v is DocTypeId => DOC_TYPES.some((t) => t.id === v);
export const docTypeLabel = (id: string) => DOC_TYPES.find((t) => t.id === id)?.label ?? id;

type TemplateDef = { docType: DocTypeId; file: string | null; provider?: RegExp };

/** templateId -> file. A provider variant is chosen by name; everything else gets the practice master. */
export const TEMPLATES: Record<string, TemplateDef> = {
  "progress_note.master": { docType: "progress_note", file: "Psychiatric Progress Note - Fillable.pdf" },
  "progress_note.ahmed": { docType: "progress_note", file: "Psychiatric Progress Note Dr.Ahmed - Fillable.pdf", provider: /ahmed/i },
  "admit_order.master": { docType: "admit_order", file: "Admit Order - Fillable.pdf" },
  "admit_order.ahmed": { docType: "admit_order", file: "Admit Order Dr.Ahmed - Fillable Copy.pdf", provider: /ahmed/i },
  "discharge_order.master": { docType: "discharge_order", file: "Discharge Order - Fillable.pdf" },
  "discharge_order.khalid": { docType: "discharge_order", file: "Discharge Order Dr. Khalid - Fillable.pdf", provider: /khalid/i },
  "psych_eval.master": { docType: "psych_eval", file: null },
};

export function templateFor(docType: DocTypeId, providerName: string): string {
  const hit = Object.entries(TEMPLATES).find(([, t]) => t.docType === docType && t.provider?.test(providerName));
  return hit ? hit[0] : `${docType}.master`;
}

const KIND_TO_TYPE: Record<DocKind, DocTypeId> = {
  EVAL_NOTE: "psych_eval",
  PROGRESS_FORM: "progress_note",
  FOLLOWUP_NOTE: "progress_note",
  DISCHARGE_FORM: "discharge_order",
  DISCHARGE_NOTE: "discharge_order",
  ADMIT_FORM: "admit_order",
};

/** Defaults for an appointment type, reusing the board's wording rules (Follow-up -> progress note, Psych Eval -> eval, ...). */
export function defaultDocTypes(appointmentType: string): DocTypeId[] {
  const out: DocTypeId[] = [];
  for (const spec of documentsFor(appointmentType)) {
    const t = KIND_TO_TYPE[spec.kind];
    if (!out.includes(t)) out.push(t);
  }
  return out;
}

/** Every type the provider may add, with the defaults for this appointment type flagged. */
export function docTypeList(appointmentType: string) {
  const defaults = defaultDocTypes(appointmentType);
  return DOC_TYPES.map((t) => ({ id: t.id, label: t.label, default: defaults.includes(t.id) }));
}

// ---- schema ----------------------------------------------------------------------------------------------------

export const PSYCH_EVAL_SECTIONS: { name: string; label: string; type: FieldType }[] = [
  ["admission_date", "Admission date", "date"],
  ["patient_demographics", "Patient demographics (age/race/sex/marital status/employment/living conditions)", "longtext"],
  ["chief_complaint", "Chief complaint (in the patient's own words)", "longtext"],
  ["reason_for_admission", "Reason for admission (voluntary/ITA/PIT)", "longtext"],
  ["history_present_illness", "History of present illness", "longtext"],
  ["current_stressors", "Current stressors", "longtext"],
  ["past_psychiatric_history", "Past psychiatric history (hospitalizations, suicide attempts, self-harm, medications, diagnoses)", "longtext"],
  ["current_providers", "Current providers (PCP, psychiatrist, therapist, agency, caseworker)", "longtext"],
  ["substance_use", "Substance use", "longtext"],
  ["medical_history", "Medical history (allergies, current medications, active problems)", "longtext"],
  ["developmental_family_history", "Developmental and family history", "longtext"],
  ["labs", "Labs", "longtext"],
  ["social_history", "Social history", "longtext"],
  ["mental_status_exam", "Mental status examination", "longtext"],
  ["patient_assets_limitations", "Patient assets and limitations", "longtext"],
  ["risk_assessment", "Risk assessment (violence, suicide, risk factors)", "longtext"],
  ["impression", "Impression (reason for admission with brief summary of symptoms)", "longtext"],
  ["diagnoses", "Diagnoses (psychiatric, medical, psychosocial)", "longtext"],
  ["treatment_plan", "Treatment plan", "longtext"],
].map(([name, label, type]) => ({ name, label, type: type as FieldType }));

export const LEGACY_FIELDS: DocField[] = [{ name: "content", label: "Note", type: "longtext" }];

const SKIP_HEADER = /^(PatientName|PatientLabel|PatientDOB|PatientMRN|EncounterDate|AdmitDate|AdmissionDate|DischargeDate|PhysicianName|MedicalProviderPrintedName)$/;

/** Fields the system writes from the visit, so the model never sees them (and never sees the patient's name). */
export const isSystemField = (name: string) => SKIP_HEADER.test(name);

function humanize(name: string): string {
  return name
    .split("_")
    .filter(Boolean)
    .map((seg) => seg.replace(/([a-z0-9])([A-Z])/g, "$1 $2").replace(/([A-Z]+)([A-Z][a-z])/g, "$1 $2"))
    .join(" / ");
}

export function templatesDir(): string {
  return process.env.NOTES_TEMPLATE_DIR || path.join(process.cwd(), "assets", "templates");
}

const bytesCache = new Map<string, Buffer>();
export function templateBytes(templateId: string): Buffer {
  const file = TEMPLATES[templateId]?.file;
  if (!file) throw new Error("template has no file");
  let b = bytesCache.get(file);
  if (!b) {
    b = fs.readFileSync(path.join(templatesDir(), file));
    bytesCache.set(file, b);
  }
  return b;
}

const schemaCache = new Map<string, DocField[]>();

/** A page-2 copy of a header field (PatientName_p2) mirrors the first-page field instead of being asked for again. */
export const mirrorBase = (name: string) => (name.endsWith("_p2") ? name.slice(0, -3) : null);

export async function schemaFor(templateId: string): Promise<DocField[]> {
  const cached = schemaCache.get(templateId);
  if (cached) return cached;
  const def = TEMPLATES[templateId];
  if (!def) throw new Error("unknown template");
  if (!def.file) {
    schemaCache.set(templateId, PSYCH_EVAL_SECTIONS);
    return PSYCH_EVAL_SECTIONS;
  }
  const pdf = await PDFDocument.load(templateBytes(templateId));
  const raw = pdf.getForm().getFields();
  const names = new Set(raw.map((f) => f.getName()));
  const fields: DocField[] = [];
  for (const f of raw) {
    const name = f.getName();
    const base = mirrorBase(name);
    if (f instanceof PDFSignature || (base && names.has(base))) continue;
    if (f instanceof PDFTextField) {
      fields.push({ name, label: humanize(name), type: f.isMultiline() ? "longtext" : /Date$/i.test(name) && !/Time/i.test(name) ? "date" : "text" });
    } else if (f instanceof PDFCheckBox) {
      const states = f.acroField.getWidgets().map((w) => w.getOnValue()?.decodeText()).filter((s): s is string => !!s);
      const distinct = [...new Set(states)];
      if (states.length > 1 && distinct.length > 1) fields.push({ name, label: humanize(name), type: "select", options: distinct });
      else fields.push({ name, label: humanize(name), type: "checkbox" });
    }
  }
  schemaCache.set(templateId, fields);
  return fields;
}

// ---- values ----------------------------------------------------------------------------------------------------

export const emptyValue = (f: DocField): FieldValue => (f.type === "checkbox" ? false : "");
export const emptyValues = (fields: DocField[]): DocValues => Object.fromEntries(fields.map((f) => [f.name, emptyValue(f)]));

export const MAX_TEXT = 20_000;

/** Why a value does not fit its field, or null when it does. */
export function valueProblem(f: DocField, v: unknown): string | null {
  if (f.type === "checkbox") return typeof v === "boolean" ? null : "expected true or false";
  if (typeof v !== "string") return "expected text";
  if (v.length > MAX_TEXT) return "too long";
  if (f.type === "select") return v === "" || f.options?.includes(v) ? null : "not one of the options";
  if (f.type === "date") return v === "" || /^\d{4}-\d{2}-\d{2}$/.test(v) ? null : "expected YYYY-MM-DD";
  return null;
}

export function sameValues(fields: DocField[], a: DocValues, b: DocValues): boolean {
  return fields.every((f) => (a[f.name] ?? emptyValue(f)) === (b[f.name] ?? emptyValue(f)));
}
