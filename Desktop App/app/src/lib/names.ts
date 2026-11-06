import type { Visit } from "./api";

/**
 * Initials by default. The practice app sends `fullName` ONLY to the few people allowed to see it, so the switch is
 * offered only when a visit carries one; for everyone else nothing here changes.
 */
export const canShowFullNames = (visits: Visit[] | null) => !!visits?.some((v) => !!v.fullName);

/** The visits as shown: with full names the label becomes the name, and `realInitials` keeps the initials for file names. */
export function displayVisits(visits: Visit[], showFull: boolean): Visit[] {
  if (!showFull) return visits;
  return visits.map((v) => (v.fullName ? { ...v, realInitials: v.initials, initials: v.fullName } : v));
}

const KEY = "practice.showFullNames";
export const loadShowFull = (): boolean => { try { return localStorage.getItem(KEY) === "1"; } catch { return false; } };
export const saveShowFull = (on: boolean) => { try { localStorage.setItem(KEY, on ? "1" : "0"); } catch { /* the choice just is not remembered */ } };
