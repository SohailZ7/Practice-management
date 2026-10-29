// Turns one recorded visit into every document its appointment type calls for (change requests 6 and 13).
//
// Each document is written straight to the patient's folder, marked DRAFT, with a "Needs your attention" list at the
// end. There is no review screen: the provider reviews in Word and deletes the DRAFT line (docs/change-requests.md).

import { documentsFor, type DocSpec } from "./documents";
import { draftNote } from "./pipeline";
import { draftForm, PROGRESS_NOTE_FIELDS, type FieldSpec } from "./formSpec";
import { fillTemplate, docxText } from "./docxFill";
import { fillForm } from "./formFill";
import { noteFileName, patientFolderName } from "./patientFolder";
import { NOT_ASSESSED, NOT_DISCUSSED } from "./sectionMap";
import type { Llm, ScheduleItem } from "./types";

export type VisitInput = {
  item: ScheduleItem;
  date: string;
  transcript: string;
  llm: Llm;
  /** Reads a template by name. */
  template: (name: DocSpec["template"]) => Promise<Uint8Array>;
  /** The patient's most recent earlier note, for the carry-forward in follow-ups and discharges. */
  priorNote?: () => Promise<{ fileName: string; bytes: Uint8Array } | null>;
  /** Writes one finished document. Returns the path it was saved to. */
  save: (folder: string, date: string, file: string, bytes: Uint8Array) => Promise<string>;
  /** Names already in the visit folder, so a second run does not clash. */
  existing?: string[];
  onProgress?: (p: { document: string; done: number; total: number; detail: string }) => void;
};

export type GeneratedDoc = { label: string; file: string; path: string; attention: number };

/** The fields to ask for each form. Only the progress note is specified so far; the orders reuse it for now. */
function fieldsFor(spec: DocSpec): FieldSpec[] {
  return PROGRESS_NOTE_FIELDS;
}

/** Turns a drafted narrative note into the "Needs your attention" list for the end of the document. */
function attentionFromNote(sections: { heading: string; mustConfirm?: boolean; paragraphs: { label?: string; text: string; flag?: string; removed?: { text: string; reason: string } }[] }[]): string[] {
  const out: string[] = [];
  for (const s of sections) {
    const title = s.heading.replace(/^\d+\.\s*/, "");
    if (s.mustConfirm) out.push(`${title}: confirm every line of this section before signing.`);
    for (const p of s.paragraphs) {
      const where = `${title}${p.label ? ` / ${p.label}` : ""}`;
      if (p.removed) out.push(`${where}: removed because it was ${p.removed.reason}. It said: "${p.removed.text}"`);
      else if (p.flag === "ungrounded") out.push(`${where}: contains a value that could not be found in the recording.`);
      else if (p.flag === "confirm") out.push(`${where}: check who said this.`);
    }
    if (s.paragraphs.every((p) => p.text === NOT_ASSESSED)) out.push(`${title}: left as the blank template; the recording cannot fill it.`);
  }
  return out;
}

async function generateOne(input: VisitInput, spec: DocSpec, index: number, total: number): Promise<GeneratedDoc> {
  const { item, date, transcript } = input;
  const patient = item.patient!;
  const folder = patientFolderName(patient.lastName, patient.firstName);
  const say = (detail: string) => input.onProgress?.({ document: spec.label, done: index, total, detail });

  let bytes: Uint8Array;
  let attention: string[];

  if (spec.template === "master") {
    say("reading the earlier note");
    let prior: { fileName: string; text: string } | undefined;
    if (spec.noteKind !== "EVAL" && input.priorNote) {
      const found = await input.priorNote();
      if (found) prior = { fileName: found.fileName, text: await docxText(found.bytes) };
    }
    say("writing the note");
    const note = await draftNote({
      kind: spec.noteKind!,
      transcript,
      mode: "recording",
      visitDate: date,
      typeLabel: spec.label,
      providerName: item.provider?.name ?? "",
      patientName: `${patient.lastName}, ${patient.firstName}`,
      priorNote: prior,
      llm: input.llm,
      onProgress: (done, all, heading) => say(`section ${done} of ${all}: ${heading.replace(/^\d+\.\s*/, "")}`),
    });
    attention = attentionFromNote(note.sections);
    say("building the document");
    bytes = (await fillTemplate(await input.template(spec.template), note, { attention })).bytes;
  } else {
    say("filling the form");
    const fields = fieldsFor(spec);
    const draft = await draftForm(input.llm, fields, transcript, (done, all, field) => say(`field ${done} of ${all}: ${field}`));
    attention = [
      ...draft.needsAttention.map((f) => `${f}: confirm this before signing.`),
      ...(draft.blank.length ? [`Left blank because the recording did not cover them: ${draft.blank.join(", ")}.`] : []),
    ];
    say("building the document");
    const filled = await fillForm(await input.template(spec.template), draft.values, { attention });
    for (const u of filled.unknownOptions) attention.push(`${u.field}: the model suggested "${u.option}", which is not an option on this form.`);
    bytes = filled.bytes;
  }

  const taken = new Set(input.existing ?? []);
  const file = noteFileName(date, spec.label, (n) => taken.has(n), `${folder} `);
  const path = await input.save(folder, date, file, bytes);
  taken.add(file);
  input.existing?.push(file);
  return { label: spec.label, file, path, attention: attention.length };
}

/** Generates every document for the visit, one at a time: two models at once would not fit in memory. */
export async function generateVisit(input: VisitInput): Promise<GeneratedDoc[]> {
  if (!input.item.patient) throw new Error("This row has no patient name, so there is nowhere to save the documents.");
  if (!input.transcript.trim()) throw new Error("The recording produced no transcript.");
  const specs = documentsFor(input.item.type);
  if (!specs.length) throw new Error(`No documents are defined for "${input.item.type}".`);

  const out: GeneratedDoc[] = [];
  for (const [i, spec] of specs.entries()) out.push(await generateOne(input, spec, i, specs.length));
  return out;
}

export { NOT_DISCUSSED };
