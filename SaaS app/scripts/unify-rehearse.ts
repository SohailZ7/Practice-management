// REHEARSAL GATE (safeguard 8, gate 4): the full Release A on a SCRATCH copy of production (restored backup) or a local
// database. Never runs on the production or staging databases. Counts and hashes only; prints GATE lines; exit 1 if red.
//   SCRATCH_CONFIRM=SCRATCH-COPY-<db host> DATABASE_URL=<scratch> npx tsx scripts/unify-rehearse.ts --scratch-copy [--with-rollback]
import { execFileSync } from "node:child_process";
import { rehearsalVerdict } from "../src/lib/unify/guards";
import { gateSchemaSql, splitDiffSql, withoutSnapshotDrops } from "../src/lib/schemaGate";
const v = rehearsalVerdict(process.env, process.argv.slice(2));
if (!v.ok) { console.error(`REFUSED: ${v.reason}`); process.exit(1); }
import { has, run } from "./unify-common";

run(async () => {
  const { PrismaClient } = await import("@prisma/client");
  const R = await import("../src/lib/unify/runner");
  const { postRunGates, allGreen, formatGates } = await import("../src/lib/unify/gates");
  const db = new PrismaClient();
  try {
    const hasCols = Number((await db.$queryRaw<{ n: bigint }[]>`SELECT count(*) AS n FROM information_schema.columns WHERE table_name = 'Visit' AND column_name = 'backfilledAt'`)[0].n) > 0;
    if (!hasCols) {
      const sql = withoutSnapshotDrops(execFileSync("npx", ["prisma", "migrate", "diff", "--from-url", process.env.DATABASE_URL as string, "--to-schema-datamodel", "prisma/schema.prisma", "--script"], { encoding: "utf8" }));
      const violations = gateSchemaSql(sql);
      if (violations.length) { console.log(`GATE schema: FAIL (${violations.length} non-additive statement(s))`); process.exit(1); }
      const stmts = splitDiffSql(sql);
      await db.$transaction(stmts.map((s) => db.$executeRawUnsafe(s)));
      console.log(`GATE schema: PASS (additive only, ${stmts.length} statements applied to the scratch copy)`);
    }
    const before = { counts: await R.tableCounts(db), fp: await R.fingerprint(db) };
    console.log("BEFORE " + JSON.stringify(before));
    const stamp = new Date().toISOString().slice(0, 10).replace(/-/g, "");
    await db.$executeRawUnsafe(`DO $$ DECLARE r record; BEGIN FOR r IN SELECT table_name FROM information_schema.tables WHERE table_name LIKE '\\_snap\\_${stamp}\\_%' LOOP EXECUTE 'DROP TABLE "' || r.table_name || '"'; END LOOP; END $$`);
    await R.takeSnapshot(db, stamp);
    const plan = await R.loadPlan(db);
    console.log("DRYRUN_COUNTS " + JSON.stringify(plan.counts));
    const applied = await R.applyPlan(db, plan);
    console.log("APPLIED " + JSON.stringify(applied));
    const again = await R.loadPlan(db);
    const idempotent = again.counts.toFill === 0 && again.counts.toInsert === 0;
    console.log(`GATE idempotent: ${idempotent ? "PASS" : "FAIL"} (second plan toFill=${again.counts.toFill} toInsert=${again.counts.toInsert})`);
    const gates = postRunGates({
      before: before.counts, after: await R.tableCounts(db), fpBefore: before.fp, fpAfter: await R.fingerprint(db),
      visitDiff: await R.diffAgainstSnapshot(db, stamp, "visit"), entryDiff: await R.diffAgainstSnapshot(db, stamp, "scheduleentry"),
      inboxDiff: await R.diffAgainstSnapshot(db, stamp, "inbox"), expectInserts: applied.inserted,
    });
    console.log(formatGates(gates));
    let ok = idempotent && allGreen(gates);
    if (has("--with-rollback")) {
      const rb = await R.rollbackRelease(db);
      const afterRb = { counts: await R.tableCounts(db), fp: await R.fingerprint(db) };
      const same = JSON.stringify(afterRb.counts) === JSON.stringify(before.counts) && afterRb.fp.visitHash === before.fp.visitHash && afterRb.fp.inboxHash === before.fp.inboxHash;
      console.log(`GATE rollback: ${same && rb.keptInUse === 0 ? "PASS" : "FAIL"} (deleted=${rb.deleted} cleared=${rb.cleared} kept=${rb.keptInUse}; counts and fingerprint back to BEFORE: ${same})`);
      ok = ok && same && rb.keptInUse === 0;
    }
    console.log(`GATE rehearsal: ${ok ? "PASS" : "FAIL"}`);
    if (!ok) process.exit(1);
  } finally { await db.$disconnect(); }
});
