// Fills a template's field schema from a visit transcript with the note-writing model.
//
// The model sees the transcript and the field list only: never the patient's name. Fields the system knows (name,
// visit date, provider) are written afterwards, and are listed in `isSystemField` so the training export can set them
// apart from what the model produced. Answers are checked against the schema; entries naming an unknown field or of
// the wrong type are dropped, nothing else is changed. That checked answer is version 1.

import { stripThinking } from "./text";
import type { Llm } from "./types";
import { emptyValues, isSystemField, schemaFor, valueProblem, type DocField, type DocTypeId, type DocValues } from "./docTemplates";

export const BATCH_SIZE = 50;

export const FILL_SYSTEM = [
  "You complete a psychiatric clinic form from a visit transcript.",
  "Use ONLY what the transcript says. Never guess, never invent, never add medical knowledge.",
  "Only the patient's own statements are the patient's report; what a relative or the doctor said is not.",
  "A checkbox is true only when the transcript supports it. Leave everything else out: an omitted field means not assessed.",
  "A select takes exactly one of its listed options. Text is a short third-person phrase; longtext may be a few sentences.",
  "Dates are YYYY-MM-DD.",
  'Reply with one JSON object and nothing else: {"<field name>": <value>, ...} containing only the fields the transcript supports.',
].join("\n");

const FOCUS: Record<DocTypeId, string> = {
  progress_note: "This is a psychiatric progress note for a follow-up visit.",
  admit_order: "This is the admit-to-outpatient-program order. Orders such as labs, diet and consults are the doctor's decisions: fill them only when the doctor said them aloud.",
  discharge_order: "This is a physician discharge order. Much of it is the doctor's decisions: fill only what was said.",
  psych_eval: "This is an admission psychiatric evaluation. Write each section as concise clinical prose from the transcript.",
};

export function describeFields(fields: DocField[]): string {
  return fields
    .map((f) => JSON.stringify({ name: f.name, label: f.label, type: f.type, ...(f.options ? { options: f.options } : {}) }))
    .join("\n");
}

/** Pulls the JSON object out of a model reply (code fences and thinking text tolerated). */
export function parseJsonObject(raw: string): Record<string, unknown> | null {
  const t = stripThinking(raw).replace(/```(?:json)?/gi, "");
  const start = t.indexOf("{");
  const end = t.lastIndexOf("}");
  if (start < 0 || end <= start) return null;
  try {
    const v = JSON.parse(t.slice(start, end + 1));
    return v && typeof v === "object" && !Array.isArray(v) ? (v as Record<string, unknown>) : null;
  } catch {
    return null;
  }
}

export type FillContext = {
  docType: DocTypeId;
  templateId: string;
  transcript: string;
  visitDate: string;
  providerName: string;
  patientLabel: string;
  llm: Llm;
};

/** What the system writes itself on each template. */
export function systemValues(fields: DocField[], ctx: Pick<FillContext, "visitDate" | "providerName" | "patientLabel">): DocValues {
  const out: DocValues = {};
  for (const f of fields) {
    if (!isSystemField(f.name)) continue;
    if (/^(PatientName|PatientLabel)$/.test(f.name)) out[f.name] = ctx.patientLabel;
    else if (/Date$/.test(f.name)) out[f.name] = ctx.visitDate;
    else if (/^(PhysicianName|MedicalProviderPrintedName)$/.test(f.name)) out[f.name] = ctx.providerName;
  }
  return out;
}

export async function fillDocument(ctx: FillContext): Promise<DocValues> {
  const fields = await schemaFor(ctx.templateId);
  const asked = fields.filter((f) => !isSystemField(f.name));
  const byName = new Map(asked.map((f) => [f.name, f]));
  const values: DocValues = { ...emptyValues(fields), ...systemValues(fields, ctx) };

  for (let i = 0; i < asked.length; i += BATCH_SIZE) {
    const batch = asked.slice(i, i + BATCH_SIZE);
    const prompt = `${FOCUS[ctx.docType]}\n\nTRANSCRIPT:\n<<<\n${ctx.transcript.trim()}\n>>>\n\nFIELDS (one per line):\n${describeFields(batch)}`;
    const answer = parseJsonObject(await ctx.llm({ system: FILL_SYSTEM, prompt }));
    if (!answer) throw new Error("the model did not return a usable answer");
    const inBatch = new Set(batch.map((f) => f.name));
    for (const [name, v] of Object.entries(answer)) {
      const f = byName.get(name);
      if (!f || !inBatch.has(name) || valueProblem(f, v)) continue;
      values[name] = v as string | boolean;
    }
  }
  return values;
}
