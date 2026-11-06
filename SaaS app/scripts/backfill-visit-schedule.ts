// One-time: gives every existing Visit that has no Schedule row one (counts only in the log). Safe to re-run.
//   npx tsx scripts/backfill-visit-schedule.ts            dry run (counts)
//   npx tsx scripts/backfill-visit-schedule.ts --apply    write (staging; prod needs --allow-prod and PROD_CONFIRM)
import { guard } from "./guard";
guard({ name: "backfill-visit-schedule", readOnly: !process.argv.includes("--apply") });

async function main() {
  const { db } = await import("../src/lib/db");
  const { syncScheduleForVisit } = await import("../src/lib/notes/visitSchedule");
  const visits = await db.visit.findMany({ select: { id: true } });
  const linked = new Set((await db.scheduleEntry.findMany({ where: { visitId: { not: null } }, select: { visitId: true } })).map((e) => e.visitId));
  const todo = visits.filter((v) => !linked.has(v.id));
  console.log(`visits=${visits.length} alreadyLinked=${visits.length - todo.length} toCreate=${todo.length}`);
  if (process.argv.includes("--apply")) {
    let created = 0;
    for (const v of todo) if ((await syncScheduleForVisit(v.id)) === "created") created++;
    console.log(`created=${created}`);
  }
}
main().then(() => process.exit(0)).catch((e) => { console.error("backfill failed", e instanceof Error ? e.message : "error"); process.exit(1); });
