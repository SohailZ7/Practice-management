// Keeps staging and production data apart. A server or script must run with an APP_ENV that matches the database it
// connects to: a known prod database host only with APP_ENV=production, a known staging host only with APP_ENV=staging,
// local development only against a local host. Pure (takes env), so the same rules guard the server and every script.

export type AppEnv = "production" | "staging" | "development";

/** Private IPs of the Cloud SQL instances (bbc-pm-db-prod / bbc-pm-db-staging). Add a host here when an instance moves. */
export const KNOWN_DB_HOSTS: Record<"production" | "staging", readonly string[]> = {
  production: ["10.27.192.3"],
  staging: ["10.85.0.3"],
};
const LOCAL_HOSTS = ["localhost", "127.0.0.1", "::1", "host.docker.internal"];

export type Target = { env: AppEnv | null; host: string; database: string; kind: "production" | "staging" | "local" | "unknown" };

export function parseDbUrl(url: string | undefined): { host: string; database: string } | null {
  if (!url) return null;
  try {
    const u = new URL(url);
    return { host: u.hostname.replace(/^\[|\]$/g, ""), database: decodeURIComponent(u.pathname.replace(/^\//, "")) };
  } catch {
    return null;
  }
}

export function appEnvOf(env: Record<string, string | undefined>): AppEnv | null {
  const v = (env.APP_ENV ?? "").trim().toLowerCase();
  return v === "production" || v === "staging" || v === "development" ? v : null;
}

export function describeTarget(env: Record<string, string | undefined>): Target {
  const db = parseDbUrl(env.DATABASE_URL);
  const host = db?.host ?? "";
  const kind = KNOWN_DB_HOSTS.production.includes(host) ? "production" : KNOWN_DB_HOSTS.staging.includes(host) ? "staging" : LOCAL_HOSTS.includes(host) ? "local" : "unknown";
  return { env: appEnvOf(env), host, database: db?.database ?? "", kind };
}

/** Returns a problem description, or null when APP_ENV and the database agree. */
export function envMismatch(env: Record<string, string | undefined>): string | null {
  const t = describeTarget(env);
  if (!t.host) return "DATABASE_URL is missing or not a valid URL";
  if (!t.env) return "APP_ENV must be set to production, staging or development";
  if (t.kind === "production" && t.env !== "production") return `APP_ENV=${t.env} but DATABASE_URL points at the PRODUCTION database`;
  if (t.kind === "staging" && t.env !== "staging") return `APP_ENV=${t.env} but DATABASE_URL points at the STAGING database`;
  if (t.env === "production" && t.kind !== "production") return "APP_ENV=production but DATABASE_URL is not the known production database host";
  if (t.env === "staging" && t.kind !== "staging") return "APP_ENV=staging but DATABASE_URL is not the known staging database host";
  if (t.env === "development" && t.kind !== "local") return "APP_ENV=development may only connect to a local database";
  return null;
}

/** The phrase a human types (or a job passes as PROD_CONFIRM) before a script is allowed to write to production. */
export const prodConfirmPhrase = (host: string): string => `WRITE-TO-PRODUCTION-${host}`;

export type ScriptPolicy = { name: string; neverProd?: boolean };

/**
 * Decides whether a script may run. Never on a mismatched environment; never at all on production when neverProd (seeds,
 * demo data, tests); otherwise on production only with --allow-prod AND PROD_CONFIRM equal to the confirm phrase.
 */
export function scriptVerdict(env: Record<string, string | undefined>, argv: readonly string[], policy: ScriptPolicy): { ok: true } | { ok: false; reason: string } {
  const bad = envMismatch(env);
  if (bad) return { ok: false, reason: `${policy.name}: ${bad}` };
  const t = describeTarget(env);
  if (t.kind !== "production") return { ok: true };
  if (policy.neverProd) return { ok: false, reason: `${policy.name} must never run against production` };
  if (!argv.includes("--allow-prod")) return { ok: false, reason: `${policy.name} would write to PRODUCTION: pass --allow-prod` };
  if (env.PROD_CONFIRM !== prodConfirmPhrase(t.host)) return { ok: false, reason: `${policy.name}: set PROD_CONFIRM=${prodConfirmPhrase(t.host)} to confirm a production write` };
  return { ok: true };
}
