// The visit statuses, same values, labels and tones as the web app (SaaS app/src/lib/notes/visitStatus.ts).
// The wire value is `value`; the practice app owns the list (an unknown value is refused with bad_status).
export const VISIT_STATUSES = [
  { value: "scheduled", label: "Scheduled", tone: "neutral" },
  { value: "seen", label: "Seen", tone: "ok" },
  { value: "note_signed", label: "Note signed", tone: "done" },
  { value: "no_show", label: "No-show", tone: "bad" },
  { value: "cancelled", label: "Cancelled", tone: "warn" },
] as const;

export const statusLabel = (v: string | undefined) => VISIT_STATUSES.find((s) => s.value === v)?.label ?? "Scheduled";
export const statusTone = (v: string | undefined) => VISIT_STATUSES.find((s) => s.value === v)?.tone ?? "neutral";
export const statusValue = (v: string | undefined): string => VISIT_STATUSES.find((s) => s.value === v)?.value ?? "scheduled";
