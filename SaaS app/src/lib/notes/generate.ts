// Generates every document a visit calls for, as Markdown (change request 17).
//
// Each document is written straight into the visit, marked DRAFT, with a "Needs your attention" list at the end.
// There is no review screen: the provider reviews in the editor and deletes the DRAFT line.

import { documentsFor, type DocSpec } from "./documents";
import { draftNote } from "./pipeline";
import { draftForm, ADMIT_ORDER_FIELDS, DISCHARGE_ORDER_FIELDS, PROGRESS_NOTE_FIELDS, type FieldSpec } from "./formSpec";
import { formToMarkdown, noteToMarkdown, type DocHeader } from "./markdown";
import { NOT_ASSESSED } from "./sectionMap";
import type { Llm, NoteKind } from "./types";

/** The question set belonging to each form. Asking a form the wrong set leaves every box blank. */
export function fieldsFor(template: DocSpec["template"]): FieldSpec[] {
  if (template === "discharge") return DISCHARGE_ORDER_FIELDS;
  if (template === "admit") return ADMIT_ORDER_FIELDS;
  return PROGRESS_NOTE_FIELDS;
}

const TITLES: Record<DocSpec["template"], string> = {
  master: "Psychiatric Note",
  progress: "Psychiatrist Progress Note",
  discharge: "Physician Discharge Order",
  admit: "Admit to Outpatient Program",
};

export type GenerateInput = {
  appointmentType: string;
  transcript: string;
  visitDate: string;
  patientLabel: string;
  providerName: string;
  llm: Llm;
  /** The patient's most recent earlier note, for the carry-forward in follow-ups and discharges. */
  priorNote?: { label: string; markdown: string };
  onProgress?: (p: { label: string; done: number; total: number; detail: string }) => void;
};

export type GeneratedDocument = { kind: string; label: string; markdown: string; attention: string[] };

/** What a provider must look at: removed lines, values not found in the recording, and sections left blank. */
function attentionFromNote(note: Awaited<ReturnType<typeof draftNote>>): string[] {
  const out: string[] = [];
  for (const s of note.sections) {
    const title = s.heading.replace(/^\d+\.\s*/, "");
    if (s.mustConfirm) out.push(`**${title}** — confirm every line before signing.`);
    for (const p of s.paragraphs) {
      const where = `**${title}${p.label ? ` / ${p.label}` : ""}**`;
      if (p.removed) out.push(`${where} — removed because it was ${p.removed.reason}. It said: "${p.removed.text}"`);
      else if (p.flag === "ungrounded") out.push(`${where} — contains a value that could not be found in the recording.`);
      else if (p.flag === "confirm") out.push(`${where} — check who said this.`);
    }
    if (s.action === "keep" && s.paragraphs.every((p) => p.text === NOT_ASSESSED)) {
      out.push(`**${title}** — left blank; the recording cannot fill it.`);
    }
  }
  return out;
}

async function generateOne(input: GenerateInput, spec: DocSpec, index: number, total: number): Promise<GeneratedDocument> {
  const say = (detail: string) => input.onProgress?.({ label: spec.label, done: index, total, detail });
  const header: DocHeader = {
    patient: input.patientLabel,
    visitDate: input.visitDate,
    visitType: spec.label,
    provider: input.providerName,
    priorNote: spec.template === "master" && spec.noteKind !== "EVAL" ? input.priorNote?.label : undefined,
  };

  if (spec.template === "master") {
    say("writing the note");
    const note = await draftNote({
      kind: spec.noteKind as NoteKind,
      transcript: input.transcript,
      mode: "recording",
      visitDate: input.visitDate,
      typeLabel: spec.label,
      providerName: input.providerName,
      // The patient's name is deliberately not sent to the model; it is written into the header afterwards.
      patientName: "",
      priorNote: spec.noteKind !== "EVAL" && input.priorNote ? { fileName: input.priorNote.label, text: input.priorNote.markdown } : undefined,
      llm: input.llm,
      onProgress: (done, all, heading) => say(`section ${done} of ${all}: ${heading.replace(/^\d+\.\s*/, "")}`),
    });
    const attention = attentionFromNote(note);
    return { kind: spec.kind, label: spec.label, markdown: noteToMarkdown(note, header, attention), attention };
  }

  say("filling the form");
  const fields = fieldsFor(spec.template);
  const draft = await draftForm(input.llm, fields, input.transcript, (done, all, field) => say(`field ${done} of ${all}: ${field}`));
  const attention = [
    ...draft.needsAttention.map((f) => `**${f}** — confirm this before signing.`),
    ...(draft.blank.length ? [`Left blank because the recording did not cover them: ${draft.blank.join(", ")}.`] : []),
  ];
  return {
    kind: spec.kind,
    label: spec.label,
    markdown: formToMarkdown(TITLES[spec.template], fields, draft.values, header, attention),
    attention,
  };
}

/** Generates the visit's documents one at a time, in the order the appointment type implies. */
export async function generateDocuments(input: GenerateInput): Promise<GeneratedDocument[]> {
  if (!input.transcript.trim()) throw new Error("There is no transcript to write from.");
  const specs = documentsFor(input.appointmentType);
  if (!specs.length) throw new Error(`No documents are defined for "${input.appointmentType}".`);
  const out: GeneratedDocument[] = [];
  for (const [i, spec] of specs.entries()) out.push(await generateOne(input, spec, i, specs.length));
  return out;
}
