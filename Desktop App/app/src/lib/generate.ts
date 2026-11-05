// Document generation can take about two minutes, so it runs outside any screen: the provider can leave the Visits
// screen and come back to find it finished. State is kept here, in memory only.
import { generateDocuments, noteErrorMessage, type NoteDocument, type Session } from "./api";

export type Generation =
  | { phase: "running"; since: number }
  | { phase: "done"; documents: NoteDocument[]; failedTypes: string[] }
  | { phase: "failed"; message: string };

const state = new Map<string, Generation>();
const listeners = new Set<() => void>();
const notify = () => listeners.forEach((l) => l());

export const generationFor = (visitId: string): Generation | undefined => state.get(visitId);
export const subscribe = (l: () => void) => { listeners.add(l); return () => { listeners.delete(l); }; };
export const clearGeneration = (visitId: string) => { state.delete(visitId); notify(); };

/** Starts generating the chosen types (ignored if already running). Only ids and titles are kept, not the text. */
export function startGenerate(session: Session, visitId: string, docTypes?: string[]): Promise<void> {
  if (state.get(visitId)?.phase === "running") return Promise.resolve();
  state.set(visitId, { phase: "running", since: Date.now() });
  notify();
  return generateDocuments(session, visitId, docTypes).then(
    (r) => {
      state.set(visitId, { phase: "done", documents: r.documents, failedTypes: r.errors.map((e) => e.docType).filter(Boolean) });
      notify();
    },
    (e) => { state.set(visitId, { phase: "failed", message: noteErrorMessage(e) }); notify(); },
  );
}
