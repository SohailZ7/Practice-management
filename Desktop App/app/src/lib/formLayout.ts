import type { DocField } from "./api";

/**
 * Lays a document's fields out like the printed form: titled sections, one row per question, the choices of a question
 * side by side. The server sends a flat list of fields named after the PDF ("IH_ADL_Independent", "MSE_SI_PlanText"),
 * so the layout is worked out from the names alone and works for every template.
 */
export type Item = { field: DocField; label: string; own: boolean };
export type Row = { key: string; label: string; items: Item[] };
export type Section = { key: string; title: string; paired: boolean; rows: Row[] };
export type Block = { kind: "top"; field: DocField } | { kind: "section"; section: Section };

const TITLES: Record<string, string> = {
  IH: "Interval history (as reported by staff and patient)",
  PS: "Physical status",
  MSE: "Mental status exam",
  MI: "Medical information",
  IHx: "History",
  Lab: "Labs",
  Groups: "Groups",
  Consent: "Informed consent",
  Safety: "Safety",
  Risk: "Rationale for continuous hospitalization / summary of risk",
  Therapy: "Therapy",
  Response: "Patient response to treatment",
  CareCoord: "Care coordination",
  Tobacco: "Tobacco",
  DCI: "Discharge instructions",
  TxRec: "Treatment recommendations",
  Prognosis: "Prognosis",
  DischargeMeds: "Discharge medications",
  Med: "Discharge medications",
  TORB: "Telephone / verbal order read back",
  MedicalProvider: "Medical provider",
};

const ROW_LABELS: Record<string, string> = {
  ADL: "ADL's", SI: "Suicidal ideation", HI: "Homicidal ideation", AbnMov: "Abnormal movements", PRNSeeking: "PRN meds seeking",
  PRNTaken: "PRN meds taken", MedCompliance: "Medication compliance", SelfHarm: "Self-harm thoughts", Psychomotor: "Psycho-motor",
  ThoughtProcess: "Thought processes", NewProblem: "New problem", TxPlanChange: "Change in treatment plan", Labs: "Labs ordered",
  Consults: "Consults ordered", CPT: "CPT (choose one)", MedEducation: "Medication education", Judgment: "Judgement",
};

const HIDDEN = /(^|_)(p2)$|^PatientLabel$|^Patient(Name|DOB|MRN)$|^(Encounter|Admit|Admission|Discharge)Date$/;

/** "NeedsPrompt" becomes "Needs Prompt"; digits and acronyms are kept. */
export function humanize(s: string): string {
  return s.replace(/([a-z])([A-Z])/g, "$1 $2").replace(/([A-Za-z])(\d)/g, "$1 $2").replace(/_/g, " ").trim();
}

const rowLabel = (g: string) => ROW_LABELS[g] ?? humanize(g);

/** The text of one choice: the part of the name after the question, without the helper words. */
function itemLabel(rest: string[]): string {
  const own = rest.slice(1).filter((x) => x !== "Test");
  const text = humanize(own.join(" ")).replace(/\s*(Text|Detail|Words)$/, "");
  return text;
}

export function layoutFields(fields: DocField[]): Block[] {
  const blocks: Block[] = [];
  let current: { key: string; section: Section; rows: Map<string, Row> } | null = null;
  for (const f of fields) {
    if (HIDDEN.test(f.name)) continue;
    const parts = f.name.split("_");
    if (parts.length === 1) {
      blocks.push({ kind: "top", field: f });
      current = null;
      continue;
    }
    const prefix = parts[0];
    const key = /^Med\d+$/.test(prefix) ? "Med" : prefix;
    if (!current || current.key !== key) {
      const section: Section = { key, title: TITLES[key] ?? humanize(key), paired: key === "IH", rows: [] };
      current = { key, section, rows: new Map() };
      blocks.push({ kind: "section", section });
    }
    const med = key === "Med";
    const group = med ? prefix : parts[1];
    const rest = med ? ["", ...parts.slice(1)] : parts.slice(1);
    let row = current.rows.get(group);
    if (!row) {
      row = { key: group, label: med ? `Medication ${Number(prefix.slice(3))}` : rowLabel(group), items: [] };
      current.rows.set(group, row);
      current.section.rows.push(row);
    }
    const label = itemLabel(rest);
    row.items.push({ field: f, label, own: !med && rest.length === 1 });
  }
  return blocks;
}
