// Recording-consent gate. Draft wording, NOT yet confirmed by the practice's attorney: change it HERE ONLY and bump
// CONSENT_TEXT_VERSION so every stored consent event says which wording the provider saw.
export const CONSENT_TEXT_VERSION = "2026-11-19-draft-1";
export const CONSENT_TITLE = "Before recording";
export const CONSENT_TEXT =
  "Have you told everyone present that this visit will be transcribed by an AI tool to help write the note, that no audio is saved, and that they can say no? Patient and all other participants consented.";
export const CONSENT_CHECKBOX_LABEL = "Patient (and everyone present) gave consent.";
export const CONSENT_START_LABEL = "Start recording";
export const CONSENT_CANCEL_LABEL = "Cancel / Don't record";

/** What is stored for each recording start, and sent to the server with the transcript as visit metadata. */
export type ConsentEvent = {
  visitId: string;
  providerId: string;
  timestamp: string;
  consentGiven: boolean;
  textVersion: string;
};

export function buildConsentEvent(visitId: string, providerId: string, checked: boolean, now: Date = new Date()): ConsentEvent {
  return { visitId, providerId, timestamp: now.toISOString(), consentGiven: checked === true, textVersion: CONSENT_TEXT_VERSION };
}
