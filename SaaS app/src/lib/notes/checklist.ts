// Per-visit Documentation and Orders checklist (feedback cmwlcvtc5) and the discharge flag (cmwh2x5av). Pure rules.
export const CHECKLIST_KINDS = [
  { value: "documentation", label: "Documentation", options: ["Psych Eval", "Progress Note", "Discharge Summary", "Admit Form", "Discharge Form"] },
  { value: "order", label: "Orders", options: ["Admit Order", "Discharge Order", "Medication", "Lab Order", "Other"] },
] as const;
export type ChecklistKind = (typeof CHECKLIST_KINDS)[number]["value"];

export const isChecklistKind = (v: unknown): v is ChecklistKind => CHECKLIST_KINDS.some((k) => k.value === v);
export const optionsFor = (kind: ChecklistKind): readonly string[] => CHECKLIST_KINDS.find((k) => k.value === kind)!.options;

/** A label must be one of the listed options for its kind (matched case-insensitively); returns the listed spelling or null. */
export function cleanLabel(kind: ChecklistKind, raw: unknown): string | null {
  const t = typeof raw === "string" ? raw.trim().toLowerCase() : "";
  return optionsFor(kind).find((o) => o.toLowerCase() === t) ?? null;
}

/** Sent to FFX only makes sense once the item is completed; un-completing clears it. */
export function applyToggle(cur: { done: boolean; sentToFfx: boolean }, field: "done" | "sentToFfx", value: boolean): { done: boolean; sentToFfx: boolean } {
  if (field === "done") return { done: value, sentToFfx: value ? cur.sentToFfx : false };
  return { done: cur.done, sentToFfx: value && cur.done };
}

/** The Discharged yes/no control belongs on discharge appointments. */
export const isDischargeType = (appointmentType: string) => /discharge|d\/c/i.test(appointmentType);
