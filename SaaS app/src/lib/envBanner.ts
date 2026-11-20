// Which environment this server is, for the banner across the top of every page (signed in or not) and the browser tab title.
// APP_ENV=staging on staging; development on a laptop; anything else is treated as production (the live practice).
export type EnvKind = "staging" | "development" | "production";

export const envKind = (env: Record<string, string | undefined> = process.env): EnvKind => (env.APP_ENV === "staging" ? "staging" : env.APP_ENV === "development" ? "development" : "production");

export const ENV_TEXT: Record<EnvKind, { label: string; note: string }> = {
  staging: { label: "STAGING", note: "Test data only. This is not the live practice." },
  development: { label: "DEVELOPMENT", note: "Local test copy. Not the live practice." },
  production: { label: "PRODUCTION", note: "Live practice data." },
};

/** Tab title prefix so a staging tab is never mistaken for the live one. Empty in production. */
export const titlePrefix = (k: EnvKind): string => (k === "staging" ? "[STAGING] " : k === "development" ? "[DEV] " : "");
