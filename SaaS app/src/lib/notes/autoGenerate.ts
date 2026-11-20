// Marking a visit Seen offers to write its documents straight away (the same Generate flow, including the recording
// consent step, so nothing about patient consent changes). Pure, so it is unit-tested.

export type AutoGenVisit = { status: string; hasTranscript: boolean; trackingOnly: boolean; documents: unknown[] };

/** True when changing `visit` to `next` should open the Generate flow: Seen now, a transcript to work from, nothing written yet. */
export function shouldAutoGenerate(visit: AutoGenVisit, next: string, canEdit: boolean): boolean {
  return canEdit && next === "seen" && visit.status !== "seen" && visit.hasTranscript && !visit.trackingOnly && visit.documents.length === 0;
}
