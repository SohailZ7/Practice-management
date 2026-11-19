// Takes the named snapshot tables _snap_YYYYMMDD_visit / _scheduleentry / _inbox / _meta (not temporary, kept 7+ days,
// never overwritten) with a hash per row and an overall hash. Run AFTER the promote verified and BEFORE Release A.
//   npx tsx scripts/unify-snapshot.ts --stamp 20261119 --allow-prod   (production also needs PROD_CONFIRM)
import { guard } from "./guard";
guard({ name: "unify-snapshot" });
import { arg, run, today } from "./unify-common";

run(async () => {
  const { PrismaClient } = await import("@prisma/client");
  const { takeSnapshot } = await import("../src/lib/unify/runner");
  const db = new PrismaClient();
  try {
    const meta = await takeSnapshot(db, arg("--stamp") ?? today());
    console.log("SNAPSHOT " + JSON.stringify(meta));
    console.log(`GATE snapshot: PASS (visits=${meta.visitRows} entries=${meta.entryRows} inbox=${meta.inboxRows}; keep until ${meta.keepUntil.slice(0, 10)})`);
  } finally { await db.$disconnect(); }
});
