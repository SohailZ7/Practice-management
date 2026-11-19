// Per-browser display preferences (compact density, privacy mode). Not patient data; kept in localStorage only.
export type Prefs = { compact: boolean; privacy: boolean; fullNames: boolean };
const KEY = "bb-prefs";
export const DEFAULT_PREFS: Prefs = { compact: false, privacy: false, fullNames: false };

export function parsePrefs(raw: string | null): Prefs {
  try {
    const v = JSON.parse(raw ?? "{}") as Partial<Prefs>;
    return { compact: v.compact === true, privacy: v.privacy === true, fullNames: v.fullNames === true };
  } catch {
    return DEFAULT_PREFS;
  }
}
export function readPrefs(): Prefs {
  try { return parsePrefs(window.localStorage.getItem(KEY)); } catch { return DEFAULT_PREFS; }
}
export function applyPrefs(p: Prefs) {
  const el = document.documentElement;
  if (p.compact) el.setAttribute("data-density", "compact"); else el.removeAttribute("data-density");
  if (p.privacy) el.setAttribute("data-privacy", "on"); else el.removeAttribute("data-privacy");
  if (p.fullNames) el.setAttribute("data-fullnames", "on"); else el.removeAttribute("data-fullnames");
}
export function savePrefs(p: Prefs) {
  try { window.localStorage.setItem(KEY, JSON.stringify(p)); } catch { /* private window: applies for this page only */ }
  applyPrefs(p);
  window.dispatchEvent(new Event("bb-prefs"));
}
export const initialsFor = (name: string) =>
  name.split(/\s+/).map((w) => w.match(/\p{L}/u)?.[0]?.toUpperCase() ?? "").filter(Boolean).slice(0, 2).join("") || "?";
