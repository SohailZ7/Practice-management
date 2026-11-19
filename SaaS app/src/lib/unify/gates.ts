// Release A automatic gates (MAIN-PROMPT section 2, safeguard 8). Pure: takes numbers and hashes, returns verdicts. No
// gate can be bypassed from here: the scripts print these verdict lines and the runbook stops on the first FAIL.
import type { Counts, Fingerprint, RowDiff } from "./runner";

export type Gate = { name: string; pass: boolean; detail: string };

/** Tables that must not change at all during Release A (Visit may only grow by the migration's own inserts). */
export const UNCHANGED = ["patient", "visitDocument", "recordingInbox", "encounter", "scheduleEntry", "visitDocumentVersion", "documentVersion", "provider", "visitWithTranscript"] as const;

export function backupGate(prod: Counts, scratch: Counts): Gate {
  const keys = ["patient", "visit", "visitWithTranscript", "visitDocument", "recordingInbox"] as const;
  const bad = keys.filter((k) => prod[k] !== scratch[k]);
  return { name: "backup", pass: bad.length === 0, detail: bad.length ? `restore counts differ: ${bad.map((k) => `${k} ${prod[k]} vs ${scratch[k]}`).join(", ")}` : "scratch restore counts match" };
}

export function postRunGates(a: { before: Counts; after: Counts; fpBefore: Fingerprint; fpAfter: Fingerprint; visitDiff: RowDiff; entryDiff: RowDiff; inboxDiff: RowDiff; expectInserts: number }): Gate[] {
  const g: Gate[] = [];
  const changed = UNCHANGED.filter((k) => a.before[k] !== a.after[k]);
  g.push({ name: "counts-unchanged", pass: changed.length === 0, detail: changed.length ? changed.map((k) => `${k} ${a.before[k]} -> ${a.after[k]}`).join(", ") : "Patient, VisitDocument, RecordingInbox, Encounter, ScheduleEntry and transcripts: no change" });
  const grew = a.after.visit - a.before.visit;
  g.push({ name: "visit-count", pass: grew === a.expectInserts, detail: `Visit ${a.before.visit} -> ${a.after.visit} (expected +${a.expectInserts})` });
  const fpSame = a.fpBefore.visitHash === a.fpAfter.visitHash && a.fpBefore.visitCount === a.fpAfter.visitCount && a.fpBefore.inboxHash === a.fpAfter.inboxHash && a.fpBefore.inboxCount === a.fpAfter.inboxCount;
  g.push({ name: "fingerprint", pass: fpSame, detail: fpSame ? `transcript fingerprint identical (visits=${a.fpAfter.visitCount}, inbox=${a.fpAfter.inboxCount})` : "transcript fingerprint DIFFERS" });
  const v = a.visitDiff, e = a.entryDiff, i = a.inboxDiff;
  g.push({ name: "snapshot-visit", pass: v.changed === 0 && v.missing === 0 && v.added === a.expectInserts, detail: `changed=${v.changed} missing=${v.missing} added=${v.added} (expected added=${a.expectInserts})` });
  g.push({ name: "snapshot-scheduleentry", pass: e.changed === 0 && e.missing === 0 && e.added === 0, detail: `changed=${e.changed} missing=${e.missing} added=${e.added}` });
  g.push({ name: "snapshot-inbox", pass: i.changed === 0 && i.missing === 0 && i.added === 0, detail: `changed=${i.changed} missing=${i.missing} added=${i.added}` });
  return g;
}

export const allGreen = (gates: Gate[]) => gates.every((x) => x.pass);
export const formatGates = (gates: Gate[]) => gates.map((x) => `GATE ${x.name}: ${x.pass ? "PASS" : "FAIL"} (${x.detail})`).join("\n");
