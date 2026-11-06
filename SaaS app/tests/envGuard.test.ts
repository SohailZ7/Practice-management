import { describe, expect, it } from "vitest";
import { envMismatch, prodConfirmPhrase, scriptVerdict } from "../src/lib/envGuard";
import { gateSchemaSql } from "../src/lib/schemaGate";

const url = (host: string) => `postgresql://u:p@${host}:5432/practice`;
const PROD = "10.27.192.3", STG = "10.85.0.3";

describe("APP_ENV must match the database", () => {
  it("accepts matching pairs", () => {
    expect(envMismatch({ APP_ENV: "production", DATABASE_URL: url(PROD) })).toBeNull();
    expect(envMismatch({ APP_ENV: "staging", DATABASE_URL: url(STG) })).toBeNull();
    expect(envMismatch({ APP_ENV: "development", DATABASE_URL: url("localhost") })).toBeNull();
  });
  it("refuses staging reaching prod and prod reaching staging", () => {
    expect(envMismatch({ APP_ENV: "staging", DATABASE_URL: url(PROD) })).toMatch(/PRODUCTION database/);
    expect(envMismatch({ APP_ENV: "production", DATABASE_URL: url(STG) })).toMatch(/STAGING database|not the known production/);
    expect(envMismatch({ APP_ENV: "development", DATABASE_URL: url(PROD) })).toMatch(/PRODUCTION database/);
  });
  it("refuses a missing or unknown APP_ENV, unknown hosts and a missing URL", () => {
    expect(envMismatch({ DATABASE_URL: url(PROD) })).toMatch(/APP_ENV/);
    expect(envMismatch({ APP_ENV: "production", DATABASE_URL: url("10.1.2.3") })).toMatch(/not the known production/);
    expect(envMismatch({ APP_ENV: "staging", DATABASE_URL: url("10.1.2.3") })).toMatch(/not the known staging/);
    expect(envMismatch({ APP_ENV: "development", DATABASE_URL: url("db.example.com") })).toMatch(/local/);
    expect(envMismatch({ APP_ENV: "production" })).toMatch(/DATABASE_URL/);
  });
});

describe("script guard", () => {
  const prod = { APP_ENV: "production", DATABASE_URL: url(PROD) };
  it("lets scripts run on staging and local", () => {
    expect(scriptVerdict({ APP_ENV: "staging", DATABASE_URL: url(STG) }, [], { name: "x" }).ok).toBe(true);
    expect(scriptVerdict({ APP_ENV: "development", DATABASE_URL: url("localhost") }, [], { name: "x", neverProd: true }).ok).toBe(true);
  });
  it("never lets seeds, demo or test scripts run on production, even with the flag and phrase", () => {
    const env = { ...prod, PROD_CONFIRM: prodConfirmPhrase(PROD) };
    expect(scriptVerdict(env, ["--allow-prod"], { name: "seed", neverProd: true }).ok).toBe(false);
  });
  it("needs the flag AND the typed phrase on production", () => {
    expect(scriptVerdict(prod, [], { name: "import" }).ok).toBe(false);
    expect(scriptVerdict(prod, ["--allow-prod"], { name: "import" }).ok).toBe(false);
    expect(scriptVerdict({ ...prod, PROD_CONFIRM: "yes" }, ["--allow-prod"], { name: "import" }).ok).toBe(false);
    expect(scriptVerdict({ ...prod, PROD_CONFIRM: prodConfirmPhrase(PROD) }, [], { name: "import" }).ok).toBe(false);
    expect(scriptVerdict({ ...prod, PROD_CONFIRM: prodConfirmPhrase(PROD) }, ["--allow-prod"], { name: "import" }).ok).toBe(true);
  });
  it("refuses a staging APP_ENV pointed at the prod database", () => {
    expect(scriptVerdict({ APP_ENV: "staging", DATABASE_URL: url(PROD) }, ["--allow-prod"], { name: "import" }).ok).toBe(false);
  });
});

describe("additive-only schema gate", () => {
  const rules = (sql: string) => gateSchemaSql(sql).map((v) => v.rule);
  it("passes new tables, nullable or defaulted columns and plain indexes", () => {
    const sql = `
CREATE TABLE "UserMfa" ("id" TEXT NOT NULL, "userId" TEXT NOT NULL, CONSTRAINT "UserMfa_pkey" PRIMARY KEY ("id"));
CREATE UNIQUE INDEX "UserMfa_userId_key" ON "UserMfa"("userId");
ALTER TABLE "DesktopSession" ADD COLUMN "mfaVerifiedAt" TIMESTAMP(3);
ALTER TABLE "Task" ADD COLUMN "flag" BOOLEAN NOT NULL DEFAULT false;
CREATE INDEX "Task_flag_idx" ON "Task"("flag");
ALTER TABLE "UserMfa" ADD CONSTRAINT "UserMfa_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;`;
    expect(gateSchemaSql(sql)).toEqual([]);
  });
  it("fails DROP, RENAME, type change, SET NOT NULL, NOT NULL without default", () => {
    expect(rules('ALTER TABLE "Task" DROP COLUMN "notes";')).toContain("DROP");
    expect(rules('DROP TABLE "Task";')).toContain("DROP");
    expect(rules('ALTER TABLE "Task" RENAME COLUMN "a" TO "b";')).toContain("RENAME");
    expect(rules('ALTER TABLE "Task" ALTER COLUMN "dueDate" SET DATA TYPE TIMESTAMP(3);')).toContain("column type change");
    expect(rules('ALTER TABLE "Task" ALTER COLUMN "title" SET NOT NULL;')).toContain("SET NOT NULL on an existing column");
    expect(rules('ALTER TABLE "Task" ADD COLUMN "x" TEXT NOT NULL;')).toContain("NOT NULL column without DEFAULT added to an existing table");
  });
  it("fails unique constraints and indexes added to existing tables", () => {
    expect(rules('CREATE UNIQUE INDEX "Task_title_key" ON "Task"("title");')).toContain("unique index added to an existing table");
    expect(rules('ALTER TABLE "Task" ADD CONSTRAINT "u" UNIQUE ("title");')).toContain("unique/primary-key constraint added to an existing table");
  });
  it("fails data statements and anything unrecognised", () => {
    expect(rules('DELETE FROM "Task";')).toHaveLength(1);
    expect(rules('TRUNCATE "Task";')).toHaveLength(1);
    expect(rules('UPDATE "Task" SET "title" = \'x\';')).toHaveLength(1);
    expect(rules("VACUUM FULL;")).toHaveLength(1);
  });
});
