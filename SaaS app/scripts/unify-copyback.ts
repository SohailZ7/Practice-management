// Safeguard 8 gate 7: copy back ONLY the rows whose hash differs from the snapshot, from the snapshot (never truncate and
// reload, so a recording written meanwhile is kept). Rows that are gone cannot be rebuilt here: reported, restore from the
// verified backup is Sohail's decision. Writes: production needs --allow-prod and PROD_CONFIRM.
//   npx tsx scripts/unify-copyback.ts --stamp 20261119 --allow-prod
import { guard } from "./guard";
guard({ name: "unify-copyback" });
import { arg, fail, run } from "./unify-common";

run(async () => {
  const { PrismaClient } = await import("@prisma/client");
  const { copyBackDiffering } = await import("../src/lib/unify/runner");
  const stamp = arg("--stamp");
  if (!stamp) fail("need --stamp");
  const db = new PrismaClient();
  try {
    const r = await copyBackDiffering(db, stamp);
    console.log("COPYBACK " + JSON.stringify(r));
    console.log(r.missing.visit + r.missing.scheduleentry === 0 ? "GATE copyback: PASS (re-run unify-verify.ts)" : "GATE copyback: FAIL (rows are missing; restore from the verified backup is Sohail's morning decision)");
    if (r.missing.visit + r.missing.scheduleentry > 0) process.exit(1);
  } finally { await db.$disconnect(); }
});
