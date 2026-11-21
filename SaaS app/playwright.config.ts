import { defineConfig } from "@playwright/test";
import { E2E_BASE, E2E_PORT, serverEnv } from "./e2e/env";

// Screen regression suite. `npm run test:screens` (dev server) or `E2E_PROD=1 npm run test:screens` (production build, used by the gate).
// Needs local Postgres (docker compose up -d db) and Google Chrome installed (no browser download).
const prod = process.env.E2E_PROD === "1";
export default defineConfig({
  testDir: "e2e",
  testMatch: /.*\.spec\.ts/,
  timeout: 90_000,
  workers: 1,
  retries: prod ? 1 : 0, // gate: one automatic retry; Playwright lists a pass-on-retry as "flaky", a second failure fails the gate
  reporter: [["list"]],
  use: { baseURL: E2E_BASE, channel: "chrome", trace: "off", screenshot: "only-on-failure" },
  outputDir: "e2e/.results",
  webServer: {
    command: `npx tsx e2e/prepare.ts && ` + (prod ? `npx next build && npx next start -p ${E2E_PORT}` : `npx next dev -p ${E2E_PORT}`),
    url: `${E2E_BASE}/login`,
    timeout: 600_000,
    reuseExistingServer: false,
    env: serverEnv(),
  },
});
