// Which documents a visit produces, from its appointment type (change request 6, confirmed by the owner).
//
// The appointment type names the documents: "Follow-up & Discharge Order" produces the progress note, the follow-up
// narrative note, the discharge order and the discharge summary. The Word master template is used only for the
// narrative notes; the Fairfax forms are used for the progress note and the two orders.

import type { NoteKind } from "./types";

export type DocKind =
  | "EVAL_NOTE"        // Word master template, evaluation sections
  | "PROGRESS_FORM"    // Fairfax Psychiatrist Progress Note (form 4071)
  | "FOLLOWUP_NOTE"    // Word master template, progress carry-forward block
  | "DISCHARGE_FORM"   // Fairfax Physician Discharge Order (form 4012)
  | "DISCHARGE_NOTE"   // Word master template, discharge summary block
  | "ADMIT_FORM";      // Admit to Outpatient Program order

export type DocSpec = {
  kind: DocKind;
  /** Shown on the row and used in the file name. */
  label: string;
  /** The template file this document is built from. */
  template: "master" | "progress" | "discharge" | "admit";
  /** For documents built from the Word master template, which section set to fill. */
  noteKind?: NoteKind;
};

const SPECS: Record<DocKind, DocSpec> = {
  EVAL_NOTE: { kind: "EVAL_NOTE", label: "Psych Eval", template: "master", noteKind: "EVAL" },
  PROGRESS_FORM: { kind: "PROGRESS_FORM", label: "Progress Note", template: "progress" },
  FOLLOWUP_NOTE: { kind: "FOLLOWUP_NOTE", label: "Follow-up", template: "master", noteKind: "FOLLOW_UP" },
  DISCHARGE_FORM: { kind: "DISCHARGE_FORM", label: "Discharge Order", template: "discharge" },
  DISCHARGE_NOTE: { kind: "DISCHARGE_NOTE", label: "Discharge Summary", template: "master", noteKind: "DISCHARGE" },
  ADMIT_FORM: { kind: "ADMIT_FORM", label: "Admit Order", template: "admit" },
};

/**
 * Reads the appointment type as written on the board. The wording varies ("Follow-up ", "Follow-up & Admit Order",
 * "DC Orders Only"), so each part is detected independently rather than matched as a whole string.
 */
export function documentsFor(appointmentType: string): DocSpec[] {
  const t = (appointmentType || "").toLowerCase();
  const isEval = /psych\s*eval|evaluation/.test(t);
  const isDischarge = /discharge|dc\s*order/.test(t);
  const isAdmit = /admit/.test(t);
  // "DC Orders Only" says there is no follow-up visit; anything else with a track is a follow-up.
  const isFollowUp = /follow\s*-?\s*up/.test(t) || (!isEval && !/only/.test(t) && t.trim() !== "");

  const out: DocKind[] = [];
  if (isEval) out.push("EVAL_NOTE");
  if (isFollowUp) out.push("PROGRESS_FORM", "FOLLOWUP_NOTE");
  if (isAdmit) out.push("ADMIT_FORM");
  if (isDischarge) out.push("DISCHARGE_FORM", "DISCHARGE_NOTE");
  return out.map((k) => SPECS[k]);
}

/** Rows with no documents to write, and rows the provider should not record. */
export function canRecord(item: { type: string; status: { absent: boolean; canceled: boolean; missed: boolean } }): boolean {
  const s = item.status;
  if (s.absent || s.canceled || s.missed) return false;
  return documentsFor(item.type).length > 0;
}
