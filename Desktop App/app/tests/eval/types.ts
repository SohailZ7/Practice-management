import type { NoteKind } from "../../src/lib/types";

/**
 * One synthetic test visit with ground truth. All people, dates and details are invented.
 * A check looks at the draft's text for a section (labels included) or, with no `section`, the whole note.
 *  - has:   a fact that was said and must appear
 *  - lacks: a wrong or invented statement that must NOT appear (misattribution, invented value, wrong person)
 *  - nd:    a label the visit never touched: the draft must say "not discussed" (anything else is an invention)
 */
export type Check = {
  id: string;
  kind: "has" | "lacks" | "nd";
  /** Regex source matched against the section heading, e.g. "Medication". Omit for the whole note. */
  section?: string;
  /** For nd: the label to inspect. */
  label?: string;
  /** For has / lacks: regex source, tested case-insensitively. */
  pattern?: string;
  /** What this protects against. */
  why: string;
  /** Safety weight: errors in these matter most to a clinician. */
  critical?: boolean;
};

export type Case = {
  id: string;
  title: string;
  kind: NoteKind;
  transcript: string;
  priorNote?: string;
  checks: Check[];
};
