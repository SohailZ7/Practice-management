// Turns a transcript (and, for follow-ups and discharges, the earlier note) into a draft note using a local language
// model, one section at a time (desktop spec NOT-1 to NOT-9). The model is injected so tests run without one.
import type { CaptureMode, DraftNote, DraftSection, Llm, NoteKind, Para } from "./types";
import { NOT_ASSESSED, NOT_DISCUSSED, PLANS, type SectionSpec } from "./sectionMap";
import { ungroundedTerms } from "./grounding";

export const SYSTEM_RULES = [
  "You write one section of a psychiatric clinic note from a visit transcript.",
  "Write in the third person, for example \"The patient reports ...\". Never write \"I\".",
  "Use ONLY facts stated in the TRANSCRIPT or the PRIOR NOTE. Never guess, infer, or add medical knowledge.",
  "Never state a medication, dose, diagnosis, date, number or risk level unless it appears in the sources.",
  `If something was not stated, write exactly: ${NOT_DISCUSSED}`,
  "Do not give advice, do not add headings, do not use markdown.",
].join("\n");

export type DraftInput = {
  kind: NoteKind;
  transcript: string;
  mode: CaptureMode;
  visitDate: string;
  typeLabel: string;
  providerName: string;
  patientName: string; // "Last, First"; used only for the info section, never sent to the model
  priorNote?: { fileName: string; text: string };
  llm: Llm;
  onProgress?: (done: number, total: number, heading: string) => void;
};

function sourceBlock(input: DraftInput, spec: SectionSpec): string {
  const lead = input.mode === "dictation" ? "TRANSCRIPT (the provider's dictated summary of the visit, not a conversation)" : "TRANSCRIPT";
  const parts = [`${lead}:\n<<<\n${input.transcript.trim()}\n>>>`];
  if (spec.usesPriorNote && input.priorNote) parts.push(`PRIOR NOTE (context only):\n<<<\n${input.priorNote.text.trim().slice(0, 12000)}\n>>>`);
  return parts.join("\n\n");
}

export function buildPrompt(input: DraftInput, spec: SectionSpec, headingTitle: string): string {
  const format = spec.labels && spec.labels.length
    ? `Write exactly one line per label, in this order, each as "Label: text". Labels:\n${spec.labels.map((l) => `- ${l}`).join("\n")}\nIf a label was not stated, its text must be exactly: ${NOT_DISCUSSED}`
    : `Write short paragraphs, one per line, separated by blank lines. If nothing relevant was stated, write exactly: ${NOT_DISCUSSED}`;
  return `${sourceBlock(input, spec)}\n\nSECTION: ${headingTitle}\nTASK: ${spec.instruction ?? ""}\n${format}`;
}

/** Splits model output into labeled lines, tolerating bullets, bold marks and wrapped lines. */
export function parseSection(output: string, labels: string[]): Para[] {
  const text = output.replace(/\*\*/g, "").replace(/\r/g, "").trim();
  if (!labels.length) {
    return text.split(/\n\s*\n|\n(?=[-•]\s)/).map((p) => p.replace(/^[-•]\s*/, "").trim()).filter(Boolean).map((p) => ({ text: p }));
  }
  const lines = text.split("\n");
  const byLabel = new Map<string, string>();
  let current: string | null = null;
  for (const raw of lines) {
    const line = raw.replace(/^[-•*]\s*/, "").trim();
    const hit = labels.find((l) => line.toLowerCase().startsWith(l.toLowerCase() + ":"));
    if (hit) {
      current = hit;
      byLabel.set(hit, line.slice(hit.length + 1).trim());
    } else if (current && line) {
      byLabel.set(current, `${byLabel.get(current) ?? ""} ${line}`.trim());
    }
  }
  return labels.map((label) => ({ label, text: byLabel.get(label) || NOT_DISCUSSED }));
}

/** Marks not-discussed lines and values that cannot be traced to the sources (NOT-5, NOT-9). */
export function flagParas(paras: Para[], source: string): Para[] {
  return paras.map((p) => {
    if (p.text.trim() === NOT_DISCUSSED || p.text.trim() === "") return { ...p, text: NOT_DISCUSSED, flag: "not_discussed" as const };
    const bad = ungroundedTerms(p.text, source);
    return bad.length ? { ...p, flag: "ungrounded" as const, text: p.text } : p;
  });
}

export async function draftNote(input: DraftInput): Promise<DraftNote> {
  const plan = PLANS[input.kind];
  const sections: DraftSection[] = [];
  const toFill = plan.sections.filter((s) => s.action === "fill");
  let done = 0;
  const source = `${input.transcript}\n${input.priorNote?.text ?? ""}`;

  for (const spec of plan.sections) {
    if (spec.action === "info") {
      const lines: Para[] = [
        { label: "Patient", text: input.patientName },
        { label: "Visit date", text: input.visitDate },
        { label: "Visit type", text: input.typeLabel },
        { label: "Provider", text: input.providerName },
        { label: "Source", text: input.mode === "recording" ? "Recorded visit, patient consent on file." : "Provider's dictated summary." },
      ];
      if (input.priorNote) lines.push({ label: "Carried forward from", text: input.priorNote.fileName });
      sections.push({ heading: spec.heading, action: "info", paragraphs: lines });
      continue;
    }
    if (spec.action !== "fill") {
      sections.push({ heading: spec.heading, action: spec.action, paragraphs: spec.action === "keep" ? [{ text: NOT_ASSESSED, flag: "not_assessed" }] : [] });
      continue;
    }
    input.onProgress?.(done, toFill.length, spec.heading);
    const title = spec.heading.replace(/^\d+\.\s*/, "");
    const output = await input.llm({ system: SYSTEM_RULES, prompt: buildPrompt(input, spec, title) });
    const paras = flagParas(parseSection(output, spec.labels ?? []), source);
    sections.push({ heading: spec.heading, action: "fill", paragraphs: paras.length ? paras : [{ text: NOT_DISCUSSED, flag: "not_discussed" }], mustConfirm: spec.mustConfirm });
    done += 1;
    input.onProgress?.(done, toFill.length, spec.heading);
  }
  return { kind: input.kind, title: plan.title, sections };
}
