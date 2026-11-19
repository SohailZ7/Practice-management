// Release A backfill. Dry run unless --apply. Fills only NULL columns on existing Visits and INSERTS new Visits for
// patient-matched schedule rows that have none. No transcript, status or patient change; ScheduleEntry untouched.
//   npx tsx scripts/unify-backfill.ts                          dry run (counts)
//   npx tsx scripts/unify-backfill.ts --apply                  staging/local
//   npx tsx scripts/unify-backfill.ts --apply --allow-prod     production (also needs PROD_CONFIRM, and --expect-inserts N from the dry run)
import { guard } from "./guard";
const apply = process.argv.includes("--apply");
guard({ name: "unify-backfill", readOnly: !apply });
import { arg, fail, run } from "./unify-common";

run(async () => {
  const { PrismaClient } = await import("@prisma/client");
  const { loadPlan, applyPlan } = await import("../src/lib/unify/runner");
  const db = new PrismaClient();
  try {
    const cols = await db.$queryRaw<{ n: bigint }[]>`SELECT count(*) AS n FROM information_schema.columns WHERE table_name = 'Visit' AND column_name = 'backfilledAt'`;
    if (Number(cols[0].n) === 0) fail("the Release A columns are not on this database yet (run schema:apply first)");
    const plan = await loadPlan(db);
    console.log("DRYRUN_COUNTS " + JSON.stringify(plan.counts));
    if (!apply) { console.log(`GATE backfill-dryrun: PASS (toFill=${plan.counts.toFill} toInsert=${plan.counts.toInsert}; nothing written)`); return; }
    const expect = arg("--expect-inserts");
    const { describeTarget } = await import("../src/lib/envGuard");
    if (describeTarget(process.env).kind === "production" && expect === undefined) fail("production apply needs --expect-inserts N (the toInsert count from the dry run)");
    if (expect !== undefined && Number(expect) !== plan.counts.toInsert) fail(`dry run said ${expect} inserts, now ${plan.counts.toInsert}: data moved, re-run the dry run`);
    const r = await applyPlan(db, plan);
    console.log("APPLIED " + JSON.stringify(r));
    console.log(`GATE backfill: PASS (filled=${r.filled} inserted=${r.inserted})`);
  } finally { await db.$disconnect(); }
});
