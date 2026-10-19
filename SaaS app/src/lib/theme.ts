export const THEMES = ["system", "light", "dark"] as const;
export type Theme = (typeof THEMES)[number];

export function normalizeTheme(value: unknown): Theme {
  return typeof value === "string" && (THEMES as readonly string[]).includes(value) ? (value as Theme) : "system";
}

/** Value for the <html data-theme> attribute; "system" leaves it unset so the OS preference applies. */
export function themeAttribute(theme: Theme): "light" | "dark" | undefined {
  return theme === "system" ? undefined : theme;
}
