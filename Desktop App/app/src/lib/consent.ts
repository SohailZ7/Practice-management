// Recording-consent gate. Draft wording, NOT yet confirmed by the practice's attorney: change it HERE ONLY and bump
// CONSENT_TEXT_VERSION so every stored consent event says which wording the provider saw.
export const CONSENT_TEXT_VERSION = "2026-11-20-draft-3";
export const CONSENT_TITLE = "Before recording";
// Modelled on the short spoken scripts in published AI-scribe consent guidance (University of Calgary AI scribe appendix,
// California Telehealth Resource Center ambient-listening guide): say it aloud first, offer a real "no", record that you did.
// No source is an approved legal text for Washington; the attorney must confirm before this is treated as final.
export const CONSENT_TEXT =
  "Say this to everyone present before recording: \"I use an AI tool to help write the note from our visit. It turns our conversation into text on this computer, and no audio is saved. You can say no, and you can ask me to stop at any time, and your care will be the same.\" Then ask: \"Is that okay with everyone?\" Patient and all other participants must agree before you start.";
// One tap: pressing this button IS the provider's statement that the patient and everyone present agreed (draft-3).
export const CONSENT_START_LABEL = "Patient agrees, start";
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

/** The shape the practice app stores (`consent` on the inbox PUT and the per-visit transcript POST). */
export type ConsentWire = { given: boolean; textVersion: string; at: string };
export const consentWire = (e: ConsentEvent): ConsentWire => ({ given: e.consentGiven, textVersion: e.textVersion, at: e.timestamp });
