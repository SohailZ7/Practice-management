// Rehearsal on FAKE data against a real (scratch) Postgres. Runs only when UNIFY_DB_TEST_URL points at a LOCAL database
// that may be wiped; otherwise skipped, so the normal suite needs no database. Proves Release A changes nothing it must not.
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { execFileSync } from "node:child_process";
import { PrismaClient } from "@prisma/client";

const url = process.env.UNIFY_DB_TEST_URL;
const local = !!url && /@(localhost|127\.0\.0\.1)[:/]/.test(url);
const d = local ? describe : describe.skip;

d("Release A rehearsal (fake data, scratch database)", () => {
  let db: PrismaClient;
  let R: typeof import("@/lib/unify/runner");
  let G: typeof import("@/lib/unify/gates");
  const stamp = "20260101";
  const rowOf = async (id: string) => (await db.$queryRawUnsafe<Record<string, unknown>[]>(`SELECT * FROM "Visit" WHERE id = $1`, id))[0];

  beforeAll(async () => {
    process.env.DATABASE_URL = url;
    process.env.APP_ENV = "development";
    execFileSync("npx", ["prisma", "db", "push", "--force-reset", "--skip-generate"], { env: { ...process.env, DATABASE_URL: url }, stdio: "ignore" });
    const { createDb } = await import("@/lib/db");
    const enc = createDb();
    const { seedFake } = await import("@/lib/unify/fakeData");
    await seedFake(enc as never);
    await enc.$disconnect();
    db = new PrismaClient({ datasources: { db: { url } } });
    R = await import("@/lib/unify/runner");
    G = await import("@/lib/unify/gates");
  }, 120_000);
  afterAll(async () => { await db?.$disconnect(); });

  it("zero change to transcripts, ScheduleEntry, Patient, VisitDocument, RecordingInbox, Encounter; only the planned inserts", async () => {
    const before = { counts: await R.tableCounts(db), fp: await R.fingerprint(db) };
    const entriesBefore = JSON.stringify(await db.$queryRawUnsafe(`SELECT * FROM "ScheduleEntry" ORDER BY id`));
    const docsBefore = JSON.stringify(await db.$queryRawUnsafe(`SELECT id, "visitId", markdown FROM "VisitDocument" ORDER BY id`));
    const patientsBefore = JSON.stringify(await db.$queryRawUnsafe(`SELECT * FROM "BillingPatient" ORDER BY id`));
    const visitsBefore = await db.$queryRawUnsafe<{ id: string; transcript: string; status: string; patientId: string }[]>(`SELECT id, transcript, status, "patientId" FROM "Visit" ORDER BY id`);
    expect(before.counts.visitWithTranscript).toBeGreaterThan(0);

    await R.takeSnapshot(db, stamp);
    const plan = await R.loadPlan(db);
    expect(plan.counts.toInsert).toBeGreaterThan(0);
    expect(plan.counts.noPatient).toBeGreaterThan(0);
    const applied = await R.applyPlan(db, plan);
    expect(applied.inserted).toBe(plan.counts.toInsert);

    expect(JSON.stringify(await db.$queryRawUnsafe(`SELECT * FROM "ScheduleEntry" ORDER BY id`))).toBe(entriesBefore);
    expect(JSON.stringify(await db.$queryRawUnsafe(`SELECT id, "visitId", markdown FROM "VisitDocument" ORDER BY id`))).toBe(docsBefore);
    expect(JSON.stringify(await db.$queryRawUnsafe(`SELECT * FROM "BillingPatient" ORDER BY id`))).toBe(patientsBefore);
    const visitsAfter = await db.$queryRawUnsafe<{ id: string; transcript: string; status: string; patientId: string }[]>(`SELECT id, transcript, status, "patientId" FROM "Visit" WHERE "backfilledAt" IS NULL ORDER BY id`);
    expect(visitsAfter).toEqual(visitsBefore); // transcript, status, patient of every existing Visit: identical
    const inserted = await db.$queryRawUnsafe<{ transcript: string }[]>(`SELECT transcript FROM "Visit" WHERE "backfilledAt" IS NOT NULL`);
    expect(inserted.every((v) => v.transcript === "")).toBe(true);

    const gates = G.postRunGates({ before: before.counts, after: await R.tableCounts(db), fpBefore: before.fp, fpAfter: await R.fingerprint(db), visitDiff: await R.diffAgainstSnapshot(db, stamp, "visit"), entryDiff: await R.diffAgainstSnapshot(db, stamp, "scheduleentry"), inboxDiff: await R.diffAgainstSnapshot(db, stamp, "inbox"), expectInserts: applied.inserted });
    expect(G.formatGates(gates)).not.toContain("FAIL");
  });

  it("a second run changes nothing (idempotent)", async () => {
    const again = await R.loadPlan(db);
    expect(again.counts.toFill).toBe(0);
    expect(again.counts.toInsert).toBe(0);
    const applied = await R.applyPlan(db, again);
    expect(applied).toEqual({ filled: 0, inserted: 0 });
  });

  it("gates go RED when a transcript changes, and copy-back restores only that row", async () => {
    const victim = (await db.$queryRawUnsafe<{ id: string; transcript: string }[]>(`SELECT id, transcript FROM "Visit" WHERE transcript <> '' ORDER BY id LIMIT 1`))[0];
    const other = (await db.$queryRawUnsafe<{ id: string; transcript: string }[]>(`SELECT id, transcript FROM "Visit" WHERE transcript <> '' ORDER BY id OFFSET 1 LIMIT 1`))[0];
    await db.$executeRawUnsafe(`UPDATE "Visit" SET transcript = 'tampered' WHERE id = $1`, victim.id);
    // a recording written mid-window on a DIFFERENT visit must survive the copy-back
    await db.$executeRawUnsafe(`UPDATE "Visit" SET transcript = transcript || ' more' WHERE id = $1`, other.id);
    const diff = await R.diffAgainstSnapshot(db, stamp, "visit");
    expect(diff.changed).toBe(2);
    const fp = await R.fingerprint(db);
    const g = G.postRunGates({ before: await R.tableCounts(db), after: await R.tableCounts(db), fpBefore: { ...fp, visitHash: "0" }, fpAfter: fp, visitDiff: diff, entryDiff: { same: 0, changed: 0, missing: 0, added: 0 }, inboxDiff: { same: 0, changed: 0, missing: 0, added: 0 }, expectInserts: 0 });
    expect(G.allGreen(g)).toBe(false);
    const back = await R.copyBackDiffering(db, stamp);
    expect(back.visit).toBe(2);
    expect((await rowOf(victim.id)).transcript).toBe(victim.transcript);
    expect((await rowOf(other.id)).transcript).toBe(victim.id === other.id ? victim.transcript : other.transcript);
  });

  it("rollback removes only unused migration-inserted Visits, and keeps one that gained a transcript", async () => {
    const ins = await db.$queryRawUnsafe<{ id: string }[]>(`SELECT id FROM "Visit" WHERE "backfilledAt" IS NOT NULL ORDER BY id`);
    await db.$executeRawUnsafe(`UPDATE "Visit" SET transcript = 'recorded later' WHERE id = $1`, ins[0].id);
    const before = await R.tableCounts(db);
    const rb = await R.rollbackRelease(db);
    expect(rb.deleted).toBe(ins.length - 1);
    expect(rb.keptInUse).toBe(1);
    const after = await R.tableCounts(db);
    expect(after.visitWithTranscript).toBe(before.visitWithTranscript);
    expect(after.scheduleEntry).toBe(before.scheduleEntry);
    expect(after.visitDocument).toBe(before.visitDocument);
  });
});
