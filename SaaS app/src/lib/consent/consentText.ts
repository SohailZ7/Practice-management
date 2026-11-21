// Recording-consent gate: the ONE place the consent wording and its version live (no database import, so the browser can
// use it). Web and Desktop send the version they showed; change the text only together with a new version string.
// DRAFT: the attorney has not signed off. The wording and version match Desktop (Desktop App/app/src/lib/consent.ts, CONSENT_TEXT_VERSION); change both together.

export const RECORDING_CONSENT = {
  version: "2026-11-20-draft-3",
  title: "Before recording",
  text:
    "Say this to everyone present before recording: \"I use an AI tool to help write the note from our visit. It turns our conversation into text on this computer, and no audio is saved. You can say no, and you can ask me to stop at any time, and your care will be the same.\" Then ask: \"Is that okay with everyone?\" Patient and all other participants must agree before you start.",
  checkboxLabel: "Patient (and everyone present) gave consent.",
  confirmLabel: "Continue",
  cancelLabel: "Don't record",
} as const;

/** True when the visit already has a "given" confirmation recorded for the CURRENT wording version. Anything else
 *  (no rows, declined, older wording, malformed data) means the consent dialog is still shown. */
export function hasCurrentConsent(rows: ReadonlyArray<{ given?: boolean; textVersion?: string }> | null | undefined): boolean {
  return !!rows && rows.some((c) => c && c.given === true && c.textVersion === RECORDING_CONSENT.version);
}
