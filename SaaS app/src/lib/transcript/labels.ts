// Display-only speaker names for a transcript (Visit.speakerLabels). The stored text is never changed: labels are applied
// when the transcript is shown. Stored as a small JSON map from the speaker name in the text to the name to show.
import type { Turn } from "./turns";

export const MAX_LABELS = 8;
export const MAX_NAME = 24;
export type SpeakerLabels = Record<string, string>;

/** Cleans a map from untrusted input: strings only, trimmed, 1 to 24 characters, at most 8 pairs, identity pairs dropped. */
export function sanitizeLabels(input: unknown): SpeakerLabels {
  const out: SpeakerLabels = {};
  if (!input || typeof input !== "object" || Array.isArray(input)) return out;
  for (const [k, v] of Object.entries(input as Record<string, unknown>)) {
    if (Object.keys(out).length >= MAX_LABELS) break;
    if (typeof v !== "string") continue;
    const key = k.trim(), val = v.trim();
    if (!key || !val || key.length > MAX_NAME || val.length > MAX_NAME || key === val) continue;
    out[key] = val;
  }
  return out;
}

/** Renames speakers and joins neighbours that now share a name (two voices both set to Provider become one turn). */
export function applyLabels(turns: Turn[], labels: SpeakerLabels | null | undefined): Turn[] {
  if (!labels || !Object.keys(labels).length) return turns;
  const out: Turn[] = [];
  for (const t of turns) {
    const speaker = t.speaker && labels[t.speaker] ? labels[t.speaker] : t.speaker;
    const prev = out[out.length - 1];
    if (prev && speaker && prev.speaker === speaker && prev.time && t.time) prev.text += ` ${t.text}`;
    else out.push({ ...t, speaker });
  }
  return out;
}
