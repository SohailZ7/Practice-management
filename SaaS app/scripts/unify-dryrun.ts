// Release A step: DRY RUN. Counts only, writes nothing, safe to run on production (read-only).
//   npx tsx scripts/unify-dryrun.ts [--scratch-copy]   (--scratch-copy + SCRATCH_CONFIRM: read a restored scratch database)
import { guard } from "./guard";
import { rehearsalVerdict } from "../src/lib/unify/guards";
if (process.argv.includes("--scratch-copy")) {
  const v = rehearsalVerdict(process.env, process.argv.slice(2));
  if (!v.ok) { console.error(`REFUSED: ${v.reason}`); process.exit(1); }
} else guard({ name: "unify-dryrun", readOnly: true });
import { run } from "./unify-common";

run(async () => {
  const { PrismaClient } = await import("@prisma/client");
  const { loadPlan, tableCounts, fingerprint } = await import("../src/lib/unify/runner");
  const db = new PrismaClient();
  try {
    console.log("TABLE_COUNTS " + JSON.stringify(await tableCounts(db)));
    console.log("FINGERPRINT " + JSON.stringify(await fingerprint(db)));
    const cols = await db.$queryRaw<{ n: bigint }[]>`SELECT count(*) AS n FROM information_schema.columns WHERE table_name = 'Visit' AND column_name = 'backfilledAt'`;
    if (Number(cols[0].n) === 0) { console.log("GATE dryrun: PASS (counts and fingerprint only: the Release A columns are not on this database yet; nothing written)"); return; }
    const plan = await loadPlan(db);
    console.log("DRYRUN_COUNTS " + JSON.stringify(plan.counts));
    console.log(`GATE dryrun: PASS (toFill=${plan.counts.toFill} toInsert=${plan.counts.toInsert}; nothing written)`);
  } finally { await db.$disconnect(); }
});
