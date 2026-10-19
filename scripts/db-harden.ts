// Applies prisma/sql/*.sql (database-level hardening) and checks that it took effect. Idempotent.
// Run after `prisma db push` / on every deploy:  npm run db:harden

import { readdirSync, readFileSync } from "node:fs";
import path from "node:path";
import { PrismaClient } from "@prisma/client";
import { parseSqlStatements } from "../src/lib/sqlStatements";

const TRIGGERS = ["AuditLog_append_only", "AuditLog_no_truncate", "BillingHistory_append_only", "BillingHistory_no_truncate"];

async function main() {
  const db = new PrismaClient();
  try {
    const dir = path.join(__dirname, "..", "prisma", "sql");
    for (const file of readdirSync(dir).filter((f) => f.endsWith(".sql")).sort()) {
      const statements = parseSqlStatements(readFileSync(path.join(dir, file), "utf8"));
      for (const sql of statements) await db.$executeRawUnsafe(sql);
      console.log(`applied ${file} (${statements.length} statements)`);
    }
    const found = await db.$queryRaw<{ tgname: string }[]>`SELECT tgname FROM pg_trigger WHERE NOT tgisinternal`;
    const names = new Set(found.map((r) => r.tgname));
    const missing = TRIGGERS.filter((t) => !names.has(t));
    if (missing.length) throw new Error(`missing triggers: ${missing.join(", ")}`);
    console.log(`verified ${TRIGGERS.length} append-only triggers`);
  } finally {
    await db.$disconnect();
  }
}

main().catch((e) => {
  console.error(e instanceof Error ? e.message : e);
  process.exit(1);
});
