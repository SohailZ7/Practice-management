// Note generation can take about two minutes, so it runs outside any screen: the provider can leave the Visits screen
// and come back to find it finished. State is kept here, in memory only.
import { generateNote, noteErrorMessage, type Session } from "./api";

export type Generation =
  | { phase: "running"; since: number }
  | { phase: "done"; documentId: string; title: string }
  | { phase: "failed"; message: string };

const state = new Map<string, Generation>();
const listeners = new Set<() => void>();
const notify = () => listeners.forEach((l) => l());

export const generationFor = (visitId: string): Generation | undefined => state.get(visitId);
export const subscribe = (l: () => void) => { listeners.add(l); return () => { listeners.delete(l); }; };
export const clearGeneration = (visitId: string) => { state.delete(visitId); notify(); };

/** Starts generating (ignored if already running). The note text is not kept here, only that it finished. */
export function startGenerate(session: Session, visitId: string): Promise<void> {
  if (state.get(visitId)?.phase === "running") return Promise.resolve();
  state.set(visitId, { phase: "running", since: Date.now() });
  notify();
  return generateNote(session, visitId).then(
    (r) => { state.set(visitId, { phase: "done", documentId: r.documentId, title: r.title }); notify(); },
    (e) => { state.set(visitId, { phase: "failed", message: noteErrorMessage(e) }); notify(); },
  );
}
