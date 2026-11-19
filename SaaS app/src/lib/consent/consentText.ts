// Recording-consent gate: the ONE place the consent wording and its version live (no database import, so the browser can
// use it). Web and Desktop send the version they showed; change the text only together with a new version string.
// DRAFT: the attorney has not signed off.

export const RECORDING_CONSENT = {
  version: "2026-11-19-draft-1",
  title: "Before recording",
  text:
    "Before recording: have you told everyone present that this visit will be transcribed by an AI tool to help write the note, that no audio is saved, and that they can say no? Patient and all other participants consented.",
  checkboxLabel: "Patient (and everyone present) gave consent.",
  confirmLabel: "Continue",
  cancelLabel: "Don't record",
} as const;
