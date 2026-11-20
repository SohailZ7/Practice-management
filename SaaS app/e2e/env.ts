// Shared constants for the screen regression suite. Everything here is synthetic: no real people, no patient data.
// The suite only ever talks to a throwaway LOCAL database (practice_regress) that it creates and fills itself.
export const E2E_PORT = Number(process.env.E2E_PORT ?? 3100);
export const E2E_BASE = `http://localhost:${E2E_PORT}`;
export const E2E_DB_NAME = "practice_regress";
export const E2E_ADMIN_URL = process.env.E2E_ADMIN_DATABASE_URL ?? "postgresql://practice:practice@localhost:5432/postgres";
export const E2E_DATABASE_URL = process.env.E2E_DATABASE_URL ?? `postgresql://practice:practice@localhost:5432/${E2E_DB_NAME}`;
export const E2E_SECRET = "e2e-only-secret-not-used-anywhere-else-0123456789";
export const E2E_PHI_KEY = Buffer.alloc(32, 7).toString("base64");
export const ADMIN_EMAIL = "e2e-admin@bbc.invalid";
export const STAFF_EMAIL = "e2e-staff@bbc.invalid";

/** The environment the app server and the seed script run with. */
export function serverEnv(): Record<string, string> {
  return {
    APP_ENV: "development",
    NODE_ENV: process.env.E2E_PROD === "1" ? "production" : "development",
    DATABASE_URL: E2E_DATABASE_URL,
    NEXTAUTH_SECRET: E2E_SECRET,
    NEXTAUTH_URL: E2E_BASE,
    PHI_ENCRYPTION_KEY: E2E_PHI_KEY,
    PHI_ENCRYPTION_KEY_ID: "e2e",
    GOOGLE_CLIENT_ID: "e2e",
    GOOGLE_CLIENT_SECRET: "e2e",
    NEXT_TELEMETRY_DISABLED: "1",
  };
}
