// Gated schema change (replaces `prisma db push` for any shared database). Computes the SQL that would bring the database to
// schema.prisma, runs the additive-only gate, and prints the verdict. With --apply it executes exactly that SQL in one
// transaction, after the gate passed. Never passes --accept-data-loss; there is no such option here.
//   npm run schema:apply                        dry run: prints the SQL and the verdict
//   npm run schema:apply -- --apply --allow-prod   (on production also needs PROD_CONFIRM, BACKUP_ID)
import { execFileSync } from "node:child_process";
import { PrismaClient } from "@prisma/client";
import { guard } from "./guard";
import { gateSchemaSql, splitDiffSql } from "../src/lib/schemaGate";
import { describeTarget } from "../src/lib/envGuard";

const apply = process.argv.includes("--apply");
guard({ name: apply ? "schema-apply" : "schema-diff", readOnly: !apply });

async function main() {
  const t = describeTarget(process.env);
  if (apply && t.kind === "production" && !/^[0-9A-Za-z_-]{6,}$/.test(process.env.BACKUP_ID ?? "")) {
    throw new Error("BACKUP_ID is required for a production schema change: take an on-demand Cloud SQL backup first and pass its id");
  }
  const sql = execFileSync("npx", ["prisma", "migrate", "diff", "--from-url", process.env.DATABASE_URL as string, "--to-schema-datamodel", "prisma/schema.prisma", "--script"], { encoding: "utf8" });
  if (/^-- This is an empty migration/m.test(sql) || !sql.trim()) {
    console.log("GATE: PASS (no schema changes)");
    return;
  }
  console.log(sql);
  const violations = gateSchemaSql(sql);
  if (violations.length) {
    console.log(`GATE: FAIL (${violations.length} violation(s))`);
    for (const v of violations) console.log(`  [${v.rule}] ${v.statement}`);
    process.exit(2);
  }
  console.log("GATE: PASS (additive only)");
  if (!apply) return;
  const db = new PrismaClient();
  try {
    const stmts = splitDiffSql(sql);
    await db.$transaction(stmts.map((s) => db.$executeRawUnsafe(s)));
    console.log(`APPLIED ${stmts.length} statement(s) in one transaction`);
  } finally {
    await db.$disconnect();
  }
}
main().catch((e) => {
  console.error(e instanceof Error ? e.message : e);
  process.exit(1);
});
