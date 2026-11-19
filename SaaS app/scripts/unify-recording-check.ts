// Safeguard 8 gate 5 (recording gate), the part the database can answer: no recording upload and no transcript write in the
// last N minutes (default 15). Read-only, counts only. Pausing recordings on the Macs is the operator's step; this proves quiet.
//   npx tsx scripts/unify-recording-check.ts [--minutes 15]
import { guard } from "./guard";
guard({ name: "unify-recording-check", readOnly: true });
import { arg, run } from "./unify-common";

run(async () => {
  const { PrismaClient } = await import("@prisma/client");
  const db = new PrismaClient();
  try {
    const mins = Number(arg("--minutes") ?? 15);
    const since = new Date(Date.now() - mins * 60_000);
    const inbox = await db.recordingInbox.count({ where: { OR: [{ updatedAt: { gte: since } }, { createdAt: { gte: since } }] } });
    const visits = await db.visit.count({ where: { transcriptAt: { gte: since } } });
    console.log("RECORDING_ACTIVITY " + JSON.stringify({ minutes: mins, inboxRows: inbox, visitTranscripts: visits }));
    const quiet = inbox === 0 && visits === 0;
    console.log(`GATE recording: ${quiet ? "PASS" : "FAIL"} (${quiet ? `no recording activity in ${mins} min` : "recording activity seen: skip the migration tonight, do only the promote"})`);
    if (!quiet) process.exit(1);
  } finally { await db.$disconnect(); }
});
