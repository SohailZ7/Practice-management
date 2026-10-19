import type { NoteKind, ScheduleItem } from "./types";

/** Appointment type -> which note to write (confirmed with the owner for v1). */
export function noteKindFor(type: string): NoteKind {
  const t = type.toLowerCase();
  if (t.includes("psych eval") || t.includes("evaluation")) return "EVAL";
  if (t.includes("dc orders") || t.includes("discharge")) return "DISCHARGE";
  return "FOLLOW_UP";
}

export const KIND_LABEL: Record<NoteKind, string> = {
  EVAL: "Psych Eval",
  FOLLOW_UP: "Follow-up",
  DISCHARGE: "Discharge Summary",
};

/** SCH-3 / CON-4 on the client side: the server check is the real gate. */
export function rowAction(item: ScheduleItem): "record" | "dictate" | "none" {
  const s = item.status;
  if (s.absent || s.canceled || s.missed) return "none";
  return item.consent === "on_file" && item.patient ? "record" : "dictate";
}
