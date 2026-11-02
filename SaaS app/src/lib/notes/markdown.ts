// Renders a drafted note or filled form as Markdown (change request 17). Markdown is the stored form of every
// document: it edits well in a browser, diffs cleanly between versions, and renders to PDF for download.
//
// The DRAFT line and the "Needs your attention" list are part of the document itself, because there is no review
// screen: the provider reviews in the editor and deletes the DRAFT line when the note is theirs.

import type { DraftNote, Para } from "./types";
import { NOT_ASSESSED, NOT_DISCUSSED } from "./sectionMap";
import type { FieldSpec } from "./formSpec";
import type { FormValues } from "./formValues";

export const DRAFT_LINE =
  "> **DRAFT.** Written by AI from the visit recording. Not reviewed. Check every section, then delete this line.";

/** A value the recording could not settle is marked so it stands out while reading, not just in the list at the end. */
const mark = (p: Para): string => {
  if (p.flag === "not_discussed" || p.text === NOT_DISCUSSED) return `_${NOT_DISCUSSED}_`;
  if (p.flag === "not_assessed" || p.text === NOT_ASSESSED) return `_${NOT_ASSESSED}_`;
  if (p.flag === "removed" && p.removed) return `_${NOT_DISCUSSED}_ ==removed: ${p.removed.text}==`;
  if (p.flag === "ungrounded") return `==${p.text}==`;
  if (p.flag === "confirm") return `==${p.text}== _(check who said this)_`;
  return p.text;
};

function attentionBlock(items: string[]): string {
  const lines = ["", "---", "", "## Needs your attention", ""];
  if (!items.length) lines.push("Nothing was flagged. Review the whole document anyway.");
  else lines.push(...items.map((i) => `- ${i}`));
  return lines.join("\n");
}

export type DocHeader = {
  patient: string;
  visitDate: string;
  visitType: string;
  provider: string;
  priorNote?: string;
};

function headerBlock(title: string, h: DocHeader): string {
  const rows = [
    `**Patient:** ${h.patient}`,
    `**Visit date:** ${h.visitDate}`,
    `**Visit type:** ${h.visitType}`,
    `**Provider:** ${h.provider}`,
  ];
  if (h.priorNote) rows.push(`**Carried forward from:** ${h.priorNote}`);
  return [`# ${title}`, "", DRAFT_LINE, "", ...rows].join("\n");
}

/** A narrative note (the Word master template's sections) as Markdown. */
export function noteToMarkdown(note: DraftNote, header: DocHeader, attention: string[]): string {
  const out: string[] = [headerBlock(note.title, header), ""];
  for (const s of note.sections) {
    if (s.action === "drop" || s.action === "info") continue;
    out.push(`## ${s.heading.replace(/^\d+\.\s*/, "")}`, "");
    if (s.mustConfirm) out.push("> Confirm every line of this section before signing.", "");
    for (const p of s.paragraphs) out.push(p.label ? `**${p.label}:** ${mark(p)}` : mark(p), "");
  }
  out.push(attentionBlock(attention));
  return out.join("\n").replace(/\n{3,}/g, "\n\n");
}

/** A checkbox form as Markdown: every option is a task-list item, ticked only where the recording supports it. */
export function formToMarkdown(
  title: string,
  fields: FieldSpec[],
  values: FormValues,
  header: DocHeader,
  attention: string[],
): string {
  const out: string[] = [headerBlock(title, header), ""];
  for (const spec of fields) {
    const v = values[spec.field];
    out.push(`### ${spec.field}${spec.critical ? " ⚠︎" : ""}`, "");
    if (spec.options?.length) {
      const ticked = new Set((v?.ticked ?? []).map((t) => t.toLowerCase()));
      for (const o of spec.options) out.push(`- [${ticked.has(o.toLowerCase()) ? "x" : " "}] ${o}`);
      out.push("");
    }
    if (spec.text) out.push(v?.text ? v.text : `_${NOT_DISCUSSED}_`, "");
    else if (!spec.options?.length) out.push(`_${NOT_DISCUSSED}_`, "");
  }
  out.push(attentionBlock(attention));
  return out.join("\n").replace(/\n{3,}/g, "\n\n");
}

/** True once a person has taken the DRAFT line out: the only signal that a document has been reviewed. */
export const isDraft = (markdown: string): boolean => markdown.includes("**DRAFT.**");
