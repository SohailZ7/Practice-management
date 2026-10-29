// What to ask the model for each field of the practice's checkbox forms, and how to turn its answers into ticks.
//
// The style rules come from docs/form-filling-style.md: boxes before prose, a phrase rather than a paragraph, and a
// blank box means "not assessed", so nothing is ticked unless the transcript supports it.

import type { Llm } from "./types";
import { stripThinking } from "./text";
import type { FormValues } from "./formFill";

export type FieldSpec = {
  /** The label as it appears on the form. */
  field: string;
  /** The options on the form, or omitted for a free-text field. */
  options?: string[];
  /** Plain-language question put to the model. */
  ask: string;
  /** Free text as well as (or instead of) a tick. */
  text?: boolean;
  /** Risk-bearing: shown first in the "needs your attention" list. */
  critical?: boolean;
};

export const FORM_SYSTEM = [
  "You read a psychiatric visit transcript and answer one question about it.",
  "Answer ONLY from the transcript. Never guess, infer, or add medical knowledge.",
  "If the transcript does not say, answer NONE. A blank answer on this form means 'not assessed', which is correct and safe.",
  "Only the patient's own statements count as the patient's. What a relative or the doctor said is not the patient's report.",
  "Reply with exactly two lines and nothing else:",
  "CHOOSE: the option or options from the list that the transcript supports, separated by semicolons, or NONE",
  "TEXT: a short phrase (at most 15 words) in the third person, or NONE",
].join("\n");

/** Fields of the Psychiatrist Progress Note (Fairfax form 4071), used for every follow-up visit. */
export const PROGRESS_NOTE_FIELDS: FieldSpec[] = [
  { field: "Chief Complaint", ask: "What did the patient say was the main problem, in their own words?", text: true },
  { field: "Subjective", ask: "What did the patient report about how they have been since the last visit?", text: true },
  { field: "*Sleep", options: ["Good", "Fair", "Poor"], ask: "How did the patient describe their sleep?" },
  { field: "Appetite", options: ["Good", "Fair", "Poor"], ask: "How did the patient describe their appetite?" },
  { field: "Energy", options: ["Increased", "Good", "Fair", "Poor"], ask: "How did the patient describe their energy?" },
  { field: "Medication compliance", options: ["Good", "Intermittent"], ask: "Did the patient say they have been taking their medication as prescribed, or missing doses?" },
  { field: "Self-harm Thoughts", options: ["Absent", "Present", "Improving", "Worse"], ask: "What did the patient say about thoughts of harming themselves?", critical: true },
  { field: "Withdrawal Symptoms", options: ["Absent", "Present", "Improving", "Worse"], ask: "What did the patient say about withdrawal symptoms?" },
  { field: "Anxiety", options: ["Absent", "Present", "Improving", "Worse"], ask: "What did the patient say about anxiety?" },
  { field: "Depression", options: ["Absent", "Present", "Improving", "Worse"], ask: "What did the patient say about depression or low mood?" },
  { field: "Group attendance", options: ["Good", "Fair", "Poor"], ask: "What was said about the patient attending groups?" },
  { field: "Group participation", options: ["Good", "Fair", "Poor"], ask: "What was said about the patient taking part in groups?" },
  { field: "Physical complaints", options: ["None", "Headache", "Constipation", "Nausea", "Edema", "EPS", "Tremor", "Other:"], ask: "What physical complaints did the patient report?", text: true },
  { field: "Side effects", options: ["None reported"], ask: "What medication side effects did the patient report?", text: true },
  { field: "Abnormal movements", options: ["None", "Tremor", "Dyskinesia", "Akathisia", "Other:"], ask: "What was said about abnormal movements such as tremor?" },
  { field: "Mood", ask: "In the patient's own words, how did they say their mood was?", text: true },
  { field: "Suicidal ideation", options: ["None", "Not active", "Thoughts", "Intent", "Plan:"], ask: "What did the patient say about thoughts of suicide? 'None' if they denied them.", text: true, critical: true },
  { field: "Homicidal ideation", options: ["None", "Not active", "Thoughts", "Intent", "Plan:"], ask: "What did the patient say about thoughts of harming others? 'None' if they denied them.", critical: true },
  { field: "Working Diagnosis (required)", ask: "What diagnosis did the doctor state? Use the doctor's words, and the ICD-10 code only if the doctor said one.", text: true, critical: true },
  { field: "Assessment / Plan / Medications change / Progress toward goals", ask: "What did the doctor say about the assessment and the plan, including any medication change with its dose?", text: true, critical: true },
  { field: "New problem", options: ["None", "Yes"], ask: "Did the visit identify a new problem?", text: true },
  { field: "Patient Response to Treatment", options: ["No change", "Worsening", "Minimal progress", "Improving but not at baseline yet", "Approaching stability", "Discharge planning in progress", "Other"], ask: "How did the doctor describe the patient's response to treatment so far?" },
  { field: "Consults Ordered", options: ["No", "Yes:"], ask: "Did the doctor order any consult?", text: true },
  { field: "Therapy", options: ["Psych education", "Medication education", "Supportive", "Family intervention", "Insight intervention", "Insight oriented", "CBT", "Interpersonal", "Coping skills", "CD counseling", "other:"], ask: "What kind of therapy or counselling was provided or discussed in this visit?" },
];

const NONE = /^\s*none\s*\.?\s*$/i;

/**
 * `options` matters: several forms offer "None" as a real clinical answer (the patient denies suicidal thoughts), which
 * must not be confused with the model saying it found nothing. When "None" is one of the field's options it is kept.
 */
export function parseFormAnswer(raw: string, options: string[] = []): { ticked: string[]; text?: string } {
  const t = stripThinking(raw).replace(/\*\*/g, "");
  const choose = /CHOOSE[ \t]*:[ \t]*(.*)/i.exec(t)?.[1]?.trim() ?? "";
  const text = /TEXT[ \t]*:[ \t]*(.*)/i.exec(t)?.[1]?.trim() ?? "";
  const isOption = (v: string) => options.some((o) => o.toLowerCase().replace(/:$/, "") === v.toLowerCase().replace(/:$/, ""));
  const keep = (v: string) => !!v && (isOption(v) || !NONE.test(v));
  const ticked = !choose ? [] : choose.split(/[;|]/).map((s) => s.trim().replace(/^["']|["']$/g, "")).filter(keep);
  return { ticked, text: !text || NONE.test(text) ? undefined : text };
}

export type FormDraft = {
  values: FormValues;
  /** Fields the transcript did not cover, which stay blank on the form. */
  blank: string[];
  /** Risk-bearing fields the provider must check, whether they were filled or not. */
  needsAttention: string[];
};

/** Asks the model one question per field. Fields it cannot answer are left blank, which on these forms means not assessed. */
export async function draftForm(
  llm: Llm,
  fields: FieldSpec[],
  transcript: string,
  onProgress?: (done: number, total: number, field: string) => void,
): Promise<FormDraft> {
  const values: FormValues = {};
  const blank: string[] = [];
  const needsAttention: string[] = [];

  for (const [i, spec] of fields.entries()) {
    onProgress?.(i, fields.length, spec.field);
    const optionList = spec.options?.length ? `OPTIONS:\n${spec.options.map((o) => `- ${o}`).join("\n")}` : "OPTIONS: none, answer with TEXT only";
    const raw = await llm({
      system: FORM_SYSTEM,
      prompt: `TRANSCRIPT:\n<<<\n${transcript.trim()}\n>>>\n\nFIELD: ${spec.field}\nQUESTION: ${spec.ask}\n${optionList}`,
    });
    const answer = parseFormAnswer(raw, spec.options ?? []);
    const ticked = spec.options ? answer.ticked : [];
    const text = spec.text ? answer.text : undefined;
    if (!ticked.length && !text) blank.push(spec.field);
    else values[spec.field] = { ...(ticked.length ? { ticked } : {}), ...(text ? { text } : {}) };
    if (spec.critical) needsAttention.push(spec.field);
  }
  onProgress?.(fields.length, fields.length, "");
  return { values, blank, needsAttention };
}
