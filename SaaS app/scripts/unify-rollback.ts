// Rolls back Release A data: deletes only Visits the migration inserted (backfilledAt set) that still have no transcript,
// documents, inbox link or consent row; nulls the filled columns on existing Visits. The columns themselves stay.
//   npx tsx scripts/unify-rollback.ts --allow-prod   (production also needs PROD_CONFIRM)
import { guard } from "./guard";
guard({ name: "unify-rollback" });
import { run } from "./unify-common";

run(async () => {
  const { PrismaClient } = await import("@prisma/client");
  const { rollbackRelease } = await import("../src/lib/unify/runner");
  const db = new PrismaClient();
  try {
    const r = await rollbackRelease(db);
    console.log("ROLLBACK " + JSON.stringify(r));
    console.log(r.keptInUse === 0 ? "GATE rollback: PASS" : "GATE rollback: FAIL (some inserted Visits are now in use and were kept)");
    if (r.keptInUse > 0) process.exit(1);
  } finally { await db.$disconnect(); }
});
