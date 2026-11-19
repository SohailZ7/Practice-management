// FAKE data for rehearsals and tests (invented names, invented text). Never real patients. Used by scripts/unify-seed-fake.ts
// and the database rehearsal test. Goes through the normal encrypting client, so stored transcripts look like production's.
import type { PrismaClient } from "@prisma/client";

export const FAKE_TAG = "ZZ-FAKE";

export async function seedFake(db: PrismaClient, opts: { visits?: number } = {}): Promise<Record<string, number>> {
  const n = opts.visits ?? 6;
  const prov = await db.provider.create({ data: { name: `${FAKE_TAG} Provider A` } });
  const outside = await db.provider.create({ data: { name: `${FAKE_TAG} Outside`, trackingOnly: true } });
  const program = await db.program.create({ data: { name: `${FAKE_TAG} Program ${Date.now()}` } }).catch(() => null);
  const patients = [];
  for (let i = 0; i < n + 3; i++) patients.push(await db.patient.create({ data: { lastName: `Fake${i}`, firstName: `Test${i}`, createdById: "fake" } }));
  const merged = await db.patient.create({ data: { lastName: "FakeMerged", firstName: "Test", createdById: "fake", mergedIntoId: patients[0].id } });
  // 1) mirrored: a Visit with a transcript, documents and a schedule row that points at it
  for (let i = 0; i < n; i++) {
    const v = await db.visit.create({ data: { patientId: patients[i].id, visitDate: "2026-11-10", apptTime: i % 2 ? "9:00 AM-12:00 PM" : "2:00 PM", providerName: prov.name, program: i % 3 ? "" : "PM IOP", status: i % 2 ? "seen" : "scheduled", transcript: `FAKE TRANSCRIPT ${i}: made-up words only.`, createdByEmail: "fake@bbc.invalid" } });
    await db.visitDocument.create({ data: { visitId: v.id, kind: "progress_note", label: "Progress note", markdown: `FAKE NOTE ${i}` } });
    await db.scheduleEntry.create({ data: { date: v.visitDate, section: v.program ? "TRACK" : "PSYCH_EVAL", timeLabel: v.program || v.apptTime, trackName: v.program, typeName: "Follow-up", clientInfo: `Fake${i}, Test${i}`, providerId: prov.id, providerName: prov.name, patientId: patients[i].id, visitId: v.id, completed: i % 2 === 1, dedupeKey: `fake-m-${i}` } });
  }
  // 2) patient matched, no Visit (these become inserts): each status, a range, an unparsable label, a merged patient
  const flags: Record<string, boolean>[] = [{}, { completed: true }, { absent: true }, { canceled: true }, { missed: true }];
  for (let i = 0; i < flags.length; i++) {
    await db.scheduleEntry.create({ data: { date: "2026-11-11", section: "PSYCH_EVAL", timeLabel: i === 3 ? "ASAP" : i === 2 ? "10:00 AM-11:00 AM" : "1:30 PM", typeName: "Psych Eval", clientInfo: `Fake${n + (i % 3)}, Test${n + (i % 3)}`, providerId: prov.id, providerName: prov.name, patientId: patients[n + (i % 3)].id, dedupeKey: `fake-u-${i}`, ...flags[i] } });
  }
  await db.scheduleEntry.create({ data: { date: "2026-11-12", section: "TRACK", timeLabel: "PM IOP", trackName: "PM IOP", clientInfo: "FakeMerged, Test", providerName: prov.name, providerId: prov.id, patientId: merged.id, dedupeKey: "fake-merged" } });
  // 3) tracking-only provider with a patient
  await db.scheduleEntry.create({ data: { date: "2026-11-11", section: "TRACK", timeLabel: "AM IOP", trackName: "AM IOP", clientInfo: "Fake0, Test0", providerId: outside.id, providerName: outside.name, patientId: patients[0].id, dedupeKey: "fake-out" } });
  // 4) free text, no patient (stays in ScheduleEntry)
  for (let i = 0; i < 3; i++) await db.scheduleEntry.create({ data: { date: "2026-11-11", section: "PSYCH_EVAL", timeLabel: "3:00 PM", clientInfo: `FREE TEXT FAKE ${i}`, providerName: prov.name, providerId: prov.id, dedupeKey: `fake-n-${i}` } });
  // 5) a dangling mirror link and a double claim (reported, never acted on)
  await db.scheduleEntry.create({ data: { date: "2026-11-10", section: "PSYCH_EVAL", timeLabel: "4:00 PM", clientInfo: "Fake0, Test0", patientId: patients[0].id, visitId: "missing-visit-id", providerName: prov.name, providerId: prov.id, dedupeKey: "fake-dangling" } });
  const first = await db.visit.findFirst({ orderBy: { id: "asc" } });
  if (first) await db.scheduleEntry.create({ data: { date: "2026-11-10", section: "PSYCH_EVAL", timeLabel: "5:00 PM", clientInfo: "Fake0, Test0", patientId: first.patientId, visitId: first.id, providerName: prov.name, providerId: prov.id, dedupeKey: "fake-double" } });
  // 6) inbox rows (one linked, one not) and an encounter
  const linked = await db.visit.findFirstOrThrow({ orderBy: { id: "asc" } });
  await db.recordingInbox.create({ data: { id: "fake-rec-1", seq: 3, final: true, text: "FAKE INBOX TEXT one", sha256: "a".repeat(64), recordedAt: new Date("2026-11-10T10:00:00Z"), visitId: linked.id, createdByEmail: "fake@bbc.invalid" } });
  await db.recordingInbox.create({ data: { id: "fake-rec-2", seq: 1, final: false, text: "FAKE INBOX TEXT two", sha256: "b".repeat(64), recordedAt: new Date("2026-11-10T11:00:00Z"), createdByEmail: "fake@bbc.invalid" } });
  if (program) await db.encounter.create({ data: { patientId: patients[0].id, encounterDate: "2026-11-10", programId: program.id, icd10Codes: [], createdById: "fake" } });
  return {};
}
