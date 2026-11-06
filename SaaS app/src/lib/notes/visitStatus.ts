// The one list of visit statuses, shared by the web Schedule, the recorder API and the schedule mirror.
// Wire values are the `value` strings; labels and tones are for display only.

export const VISIT_STATUSES = [
  { value: "scheduled", label: "Scheduled", tone: "neutral" },
  { value: "seen", label: "Seen", tone: "ok" },
  { value: "note_signed", label: "Note signed", tone: "done" },
  { value: "no_show", label: "No-show", tone: "bad" },
  { value: "cancelled", label: "Cancelled", tone: "warn" },
] as const;

export type VisitStatus = (typeof VISIT_STATUSES)[number]["value"];
export const DEFAULT_STATUS: VisitStatus = "scheduled";

export const isVisitStatus = (v: unknown): v is VisitStatus => VISIT_STATUSES.some((s) => s.value === v);
export const statusLabel = (v: string) => VISIT_STATUSES.find((s) => s.value === v)?.label ?? "Scheduled";
export const statusTone = (v: string) => VISIT_STATUSES.find((s) => s.value === v)?.tone ?? "neutral";

/** The Schedule grid's old checkboxes, derived from the status so both views agree. */
export function flagsForStatus(v: string) {
  return {
    completed: v === "seen" || v === "note_signed",
    absent: v === "no_show",
    canceled: v === "cancelled",
    missed: false,
  };
}
