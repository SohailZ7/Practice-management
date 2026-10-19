// Pure rules for AI-documentation consent (requirements v19, CON-1 to CON-8). No database or framework imports.
import { isISODate } from "./dates";

export const MAX_CONSENT_NOTE = 200;

export type ConsentRow = { active: boolean; consentDate: string };

export type ConsentCheck = { allowed: true } | { allowed: false; reason: "no_patient" | "no_consent" };

/** CON-4 / CON-8: the answer the Desktop App gets before it may record. Opaque on purpose. */
export function recordingCheck(patientId: string | null | undefined, consents: ConsentRow[]): ConsentCheck {
  if (!patientId) return { allowed: false, reason: "no_patient" };
  return consents.some((c) => c.active) ? { allowed: true } : { allowed: false, reason: "no_consent" };
}

/** CON-1, CON-6: the consent date must be a real date and not in the future (practice time zone). */
export function validateConsent(input: { consentDate?: unknown; note?: unknown }, today: string) {
  const consentDate = typeof input.consentDate === "string" ? input.consentDate.trim() : "";
  const note = typeof input.note === "string" ? input.note.replace(/[\u0000-\u001f\u007f]+/g, " ").trim() : "";
  const errors: Record<string, string> = {};
  if (!isISODate(consentDate)) errors.consentDate = "Enter the date consent was given.";
  else if (consentDate > today) errors.consentDate = "The consent date cannot be in the future.";
  if (note.length > MAX_CONSENT_NOTE) errors.note = `Keep the note to ${MAX_CONSENT_NOTE} characters.`;
  return { values: { consentDate, note }, errors, ok: Object.keys(errors).length === 0 };
}

/** The badge shown on the schedule board (SCH-4 in the desktop spec, CON-2 here). */
export function consentBadge(patientId: string | null | undefined, consents: ConsentRow[]): "none" | "on_file" | "unlinked" {
  if (!patientId) return "unlinked";
  return consents.some((c) => c.active) ? "on_file" : "none";
}
