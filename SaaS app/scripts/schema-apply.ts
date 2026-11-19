// Gated schema change (replaces `prisma db push` for any shared database). Computes the SQL that would bring the database to
// schema.prisma, runs the additive-only gate, and prints the verdict. With --apply it executes exactly that SQL in one
// transaction, after the gate passed. Never passes --accept-data-loss; there is no such option here.
//   npm run schema:apply                        dry run: prints the SQL and the verdict
//   npm run schema:apply -- --apply --allow-prod   (on production also needs PROD_CONFIRM, BACKUP_ID)
import { execFileSync } from "node:child_process";
import { PrismaClient } from "@prisma/client";
import { guard } from "./guard";
import { gateSchemaSql, splitApprovedDrops, splitDiffSql, withoutSnapshotDrops } from "../src/lib/schemaGate";
import { describeTarget } from "../src/lib/envGuard";

const apply = process.argv.includes("--apply");
guard({ name: apply ? "schema-apply" : "schema-diff", readOnly: !apply });

/** Everything that must be true right before ScheduleEntry is dropped. Counts only. */
async function dropPreflight(db: PrismaClient) {
  const { verifyUnmatched, dropReady } = await import("../src/lib/unify/unmatched");
  if (!/^[0-9A-Za-z_-]{6,}$/.test(process.env.BACKUP_ID ?? "")) throw new Error("BACKUP_ID is required to drop ScheduleEntry: take a verified on-demand backup first");
  const stamp = process.env.SNAP_STAMP ?? "";
  if (!/^20\d{6}$/.test(stamp)) throw new Error("SNAP_STAMP (YYYYMMDD of the snapshot taken right before the drop) is required");
  const snap = await db.$queryRawUnsafe<{ n: bigint }[]>(`SELECT count(*) n FROM "_snap_${stamp}_scheduleentry"`);
  const live = await db.$queryRawUnsafe<{ n: bigint }[]>(`SELECT count(*) n FROM "ScheduleEntry"`);
  if (Number(snap[0].n) !== Number(live[0].n)) throw new Error(`the snapshot has ${snap[0].n} ScheduleEntry rows but the table has ${live[0].n}: take a fresh snapshot`);
  const r = await verifyUnmatched(db as never);
  const d = dropReady(r);
  console.log("DROP PREFLIGHT " + JSON.stringify({ ...r, snapshotRows: Number(snap[0].n) }));
  if (!d.ok) throw new Error("drop refused: " + d.why.join("; "));
}

async function main() {
  const t = describeTarget(process.env);
  if (apply && t.kind === "production" && !/^[0-9A-Za-z_-]{6,}$/.test(process.env.BACKUP_ID ?? "")) {
    throw new Error("BACKUP_ID is required for a production schema change: take an on-demand Cloud SQL backup first and pass its id");
  }
  const raw = execFileSync("npx", ["prisma", "migrate", "diff", "--from-url", process.env.DATABASE_URL as string, "--to-schema-datamodel", "prisma/schema.prisma", "--script"], { encoding: "utf8" });
  let sql = withoutSnapshotDrops(raw); // snapshot tables are kept on purpose and never dropped here
  // Release B2b: ONLY with the explicit approval variable are the ScheduleEntry drops split out (and preflighted before the apply).
  let drops: string[] = [];
  if (process.env.APPROVE_DROP_SCHEDULEENTRY === "YES-DROP-SCHEDULEENTRY") ({ rest: sql, drops } = splitApprovedDrops(sql));
  if (drops.length) console.log(`APPROVED DROP of ScheduleEntry (${drops.length} statements, run only after the preflight)`);
  if (drops.length === 0 && (splitDiffSql(sql).length === 0 || /^-- This is an empty migration/m.test(sql) || !sql.trim())) {
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
    const stmts = [...splitDiffSql(sql), ...drops];
    if (drops.length) await dropPreflight(db);
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
