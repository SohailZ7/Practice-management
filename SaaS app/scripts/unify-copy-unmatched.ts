// Release B2a step: copies ScheduleEntry rows with no patient into UnmatchedAppointment and verifies the copy.
//   npx tsx scripts/unify-copy-unmatched.ts            dry run: counts only, writes nothing
//   npx tsx scripts/unify-copy-unmatched.ts --apply    copy (idempotent), then verify
//   npx tsx scripts/unify-copy-unmatched.ts --verify   verify only
// Production also needs --allow-prod and PROD_CONFIRM (guard). Prints counts only.
import { guard } from "./guard";
guard({ name: "unify-copy-unmatched" });
import { has, run } from "./unify-common";

run(async () => {
  const { PrismaClient } = await import("@prisma/client");
  const { copyUnmatched, verifyUnmatched, dropReady } = await import("../src/lib/unify/unmatched");
  const db = new PrismaClient();
  try {
    if (has("--apply")) console.log(`COPIED ${await copyUnmatched(db as never)} rows`);
    const r = await verifyUnmatched(db as never);
    console.log("REPORT " + JSON.stringify(r));
    const d = dropReady(r);
    console.log(`GATE copy: ${d.ok ? "PASS" : "FAIL"} (${d.ok ? `source ${r.sourceNoPatient} = copied ${r.inTarget} + linked ${r.linkedToVisit}` : d.why.join("; ")})`);
    if (!has("--apply") && !has("--verify")) console.log("(dry run: nothing written; rows not copied yet show as unaccounted)");
  } finally { await db.$disconnect(); }
});
