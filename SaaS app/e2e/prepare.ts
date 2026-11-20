// Runs BEFORE the app server starts (so it loads the freshly generated Prisma client). Creates a fresh throwaway local database, applies the schema from prisma/schema.prisma, and fills it with synthetic data.
import { execFileSync } from "node:child_process";
import { PrismaClient } from "@prisma/client";
import { E2E_ADMIN_URL, E2E_DB_NAME, serverEnv } from "./env";

async function main() {
  if (!/@(localhost|127\.0\.0\.1)[:/]/.test(E2E_ADMIN_URL)) throw new Error("Screen tests only run against a local Postgres.");
  const admin = new PrismaClient({ datasources: { db: { url: E2E_ADMIN_URL } } });
  try {
    await admin.$executeRawUnsafe(`DROP DATABASE IF EXISTS ${E2E_DB_NAME} WITH (FORCE)`);
    await admin.$executeRawUnsafe(`CREATE DATABASE ${E2E_DB_NAME}`);
  } finally { await admin.$disconnect(); }
  const env = { ...process.env, ...serverEnv() };
  execFileSync("npx", ["prisma", "db", "push", "--accept-data-loss"], { env, stdio: "pipe" }); // brand-new empty throwaway DB
  execFileSync("npx", ["tsx", "e2e/seed.ts"], { env, stdio: "inherit" });
}
main().then(() => process.exit(0), (e) => { console.error(e); process.exit(1); });
