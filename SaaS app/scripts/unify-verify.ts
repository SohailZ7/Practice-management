// Post-run check (safeguard 8, gate 7) and rehearsal comparison. Compares counts and the transcript fingerprint with the
// BEFORE values and live rows with the snapshot. Read-only; prints GATE lines and exits 1 if any gate is red.
//   npx tsx scripts/unify-verify.ts --stamp 20261119 --before '<json from the BEFORE run: {"counts":..,"fp":..}>' --expect-inserts N
import { guard } from "./guard";
guard({ name: "unify-verify", readOnly: true });
import { arg, fail, run } from "./unify-common";

run(async () => {
  const { PrismaClient } = await import("@prisma/client");
  const { tableCounts, fingerprint, diffAgainstSnapshot } = await import("../src/lib/unify/runner");
  const { postRunGates, allGreen, formatGates } = await import("../src/lib/unify/gates");
  const stamp = arg("--stamp"), beforeRaw = arg("--before"), expect = arg("--expect-inserts");
  if (!stamp || !beforeRaw || expect === undefined) fail("need --stamp, --before and --expect-inserts");
  const before = JSON.parse(beforeRaw) as { counts: Record<string, number>; fp: import("../src/lib/unify/runner").Fingerprint };
  const db = new PrismaClient();
  try {
    const gates = postRunGates({
      before: before.counts, after: await tableCounts(db), fpBefore: before.fp, fpAfter: await fingerprint(db),
      visitDiff: await diffAgainstSnapshot(db, stamp, "visit"), entryDiff: await diffAgainstSnapshot(db, stamp, "scheduleentry"),
      inboxDiff: await diffAgainstSnapshot(db, stamp, "inbox"), expectInserts: Number(expect),
    });
    console.log(formatGates(gates));
    if (!allGreen(gates)) { console.log("GATE post-run: FAIL (stop; copy back differing rows with unify-copyback.ts, then re-run this)"); process.exit(1); }
    console.log("GATE post-run: PASS");
  } finally { await db.$disconnect(); }
});
