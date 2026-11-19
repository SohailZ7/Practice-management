// Transcript fingerprint: hash of every Visit id + stored transcript and of RecordingInbox, plus counts. Read-only; prints
// hashes and counts only. With --against-snapshot YYYYMMDD it also compares live rows to that snapshot.
//   npx tsx scripts/unify-fingerprint.ts [--against-snapshot 20261119]
import { guard } from "./guard";
guard({ name: "unify-fingerprint", readOnly: true });
import { arg, run } from "./unify-common";

run(async () => {
  const { PrismaClient } = await import("@prisma/client");
  const { fingerprint, tableCounts, diffAgainstSnapshot } = await import("../src/lib/unify/runner");
  const db = new PrismaClient();
  try {
    console.log("FINGERPRINT " + JSON.stringify(await fingerprint(db)));
    console.log("TABLE_COUNTS " + JSON.stringify(await tableCounts(db)));
    const snap = arg("--against-snapshot");
    if (snap) for (const w of ["visit", "scheduleentry", "inbox"] as const) console.log(`SNAPSHOT_DIFF ${w} ` + JSON.stringify(await diffAgainstSnapshot(db, snap, w)));
  } finally { await db.$disconnect(); }
});
