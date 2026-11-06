// Light / Dark / System, same three choices and same palette as the web app (see src/styles.css tokens).
export const THEMES = ["light", "dark", "system"] as const;
export type Theme = (typeof THEMES)[number];
const KEY = "bbc-theme";

export const normalizeTheme = (v: unknown): Theme => (typeof v === "string" && (THEMES as readonly string[]).includes(v) ? (v as Theme) : "light");

/** Value for <html data-theme>; "system" leaves it unset so the OS preference applies. */
export const themeAttribute = (t: Theme): "light" | "dark" | undefined => (t === "system" ? undefined : t);

export function loadTheme(): Theme {
  try { return normalizeTheme(localStorage.getItem(KEY)); } catch { return "light"; }
}

export function applyTheme(t: Theme): void {
  const a = themeAttribute(t);
  if (a) document.documentElement.setAttribute("data-theme", a); else document.documentElement.removeAttribute("data-theme");
}

export function saveTheme(t: Theme): void {
  try { localStorage.setItem(KEY, t); } catch { /* the choice still applies for this run */ }
  applyTheme(t);
}
