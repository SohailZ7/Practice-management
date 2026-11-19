import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import { planBackfill, statusFromFlags, timeColumns, type EntryRow, type VisitRow } from "@/lib/unify/plan";
import { rehearsalVerdict, scratchConfirmPhrase, snapName, snapshotStamp } from "@/lib/unify/guards";
import { allGreen, backupGate, postRunGates } from "@/lib/unify/gates";
import { gateSchemaSql } from "@/lib/schemaGate";

const d = (n: number) => new Date(2026, 10, n);
const entry = (o: Partial<EntryRow> & { id: string }): EntryRow => ({ date: "2026-11-10", section: "PSYCH_EVAL", timeLabel: "2:00 PM", trackName: "", typeName: "", providerId: null, providerName: "", absent: false, canceled: false, completed: false, missed: false, patientId: null, visitId: null, createdAt: d(1), ...o });
const visit = (o: Partial<VisitRow> & { id: string }): VisitRow => ({ patientId: "p1", visitDate: "2026-11-10", providerName: "", backfilledAt: null, legacyScheduleEntryId: null, startTime: null, endTime: null, timeLabel: null, section: null, trackName: null, providerId: null, ...o });
const providers = [{ id: "pr1", name: "Dr Fake", trackingOnly: false }, { id: "pr2", name: "Outside Fake", trackingOnly: true }];
const patients = [{ id: "p1", mergedIntoId: null }, { id: "p2", mergedIntoId: "p1" }];

describe("time and status mapping", () => {
  it("exact time = start only, range = start and end, text = nothing", () => {
    expect(timeColumns("2:00 PM")).toEqual({ startTime: "14:00", endTime: null, parsed: true });
    expect(timeColumns("9:00 AM-12:00 PM")).toEqual({ startTime: "09:00", endTime: "12:00", parsed: true });
    expect(timeColumns("ASAP").parsed).toBe(false);
  });
  it("status precedence and conflicts", () => {
    expect(statusFromFlags({ absent: false, canceled: false, completed: false, missed: false })).toEqual({ status: "scheduled", conflict: false });
    expect(statusFromFlags({ absent: false, canceled: false, completed: true, missed: false }).status).toBe("seen");
    expect(statusFromFlags({ absent: true, canceled: true, completed: false, missed: false })).toEqual({ status: "cancelled", conflict: true });
    expect(statusFromFlags({ absent: true, canceled: false, completed: false, missed: false }).status).toBe("no_show");
    expect(statusFromFlags({ absent: false, canceled: false, completed: false, missed: true }).status).toBe("missed");
  });
});

describe("backfill plan", () => {
  it("a mirrored entry only FILLS empty columns of its Visit (never status, patient, transcript)", () => {
    const p = planBackfill({ entries: [entry({ id: "e1", visitId: "v1", providerId: "pr1", completed: true })], visits: [visit({ id: "v1", timeLabel: "keep me" })], providers, patients });
    expect(p.inserts).toHaveLength(0);
    expect(p.fills).toHaveLength(1);
    const patch = p.fills[0].patch as Record<string, unknown>;
    expect(patch.timeLabel).toBeUndefined(); // already set: never overwritten
    expect(patch.legacyScheduleEntryId).toBe("e1");
    expect(patch.startTime).toBe("14:00");
    expect(Object.keys(patch).every((k) => ["legacyScheduleEntryId", "startTime", "endTime", "timeLabel", "section", "trackName", "providerId"].includes(k))).toBe(true);
  });
  it("an entry with a patient and no Visit becomes an insert; with no patient it stays (counted)", () => {
    const p = planBackfill({ entries: [entry({ id: "e1", patientId: "p1", canceled: true }), entry({ id: "e2" })], visits: [], providers, patients });
    expect(p.inserts.map((i) => [i.entryId, i.status])).toEqual([["e1", "cancelled"]]);
    expect(p.counts.noPatient).toBe(1);
  });
  it("a merged patient resolves to the surviving patient", () => {
    const p = planBackfill({ entries: [entry({ id: "e1", patientId: "p2" })], visits: [], providers, patients });
    expect(p.inserts[0].patientId).toBe("p1");
  });
  it("a dangling mirror link is reported, never recreated; a double claim goes to the oldest entry", () => {
    const p = planBackfill({ entries: [entry({ id: "e1", visitId: "gone", patientId: "p1" }), entry({ id: "e2", visitId: "v1", createdAt: d(2) }), entry({ id: "e3", visitId: "v1", createdAt: d(3) })], visits: [visit({ id: "v1" })], providers, patients });
    expect(p.counts.mirroredMissingVisit).toBe(1);
    expect(p.inserts).toHaveLength(0);
    expect(p.fills.map((f) => f.entryId)).toEqual(["e2"]);
    expect(p.counts.duplicateClaims).toBe(1);
  });
  it("is idempotent: a second plan over the result is empty", () => {
    const first = planBackfill({ entries: [entry({ id: "e1", visitId: "v1", providerId: "pr1" }), entry({ id: "e2", patientId: "p1" })], visits: [visit({ id: "v1" })], providers, patients });
    const v1 = { ...visit({ id: "v1" }), ...first.fills[0].patch } as VisitRow;
    const inserted = visit({ id: "v2", backfilledAt: d(5), legacyScheduleEntryId: "e2" });
    const second = planBackfill({ entries: [entry({ id: "e1", visitId: "v1", providerId: "pr1" }), entry({ id: "e2", patientId: "p1" })], visits: [v1, inserted], providers, patients });
    expect(second.fills).toHaveLength(0);
    expect(second.inserts).toHaveLength(0);
  });
  it("counts tracking-only providers and keeps them traceable", () => {
    const p = planBackfill({ entries: [entry({ id: "e1", patientId: "p1", providerId: "pr2" })], visits: [], providers, patients });
    expect(p.counts.trackingOnly).toBe(1);
    expect(p.inserts[0].providerId).toBe("pr2");
  });
  it("the plan carries counts and ids only (no client text)", () => {
    const p = planBackfill({ entries: [{ ...entry({ id: "e1", patientId: "p1" }), clientInfo: "SECRET NAME" } as EntryRow], visits: [], providers, patients });
    expect(JSON.stringify(p)).not.toContain("SECRET NAME");
  });
});

describe("safety guards", () => {
  it("rehearsal refuses production, staging, and anything without the flag and the typed phrase", () => {
    const base = { APP_ENV: "development", DATABASE_URL: "postgresql://u:p@localhost:5432/scratch" };
    expect(rehearsalVerdict({ ...base, DATABASE_URL: "postgresql://u:p@10.27.192.3:5432/x" }, ["--scratch-copy"]).ok).toBe(false);
    expect(rehearsalVerdict({ ...base, DATABASE_URL: "postgresql://u:p@10.85.0.3:5432/x" }, ["--scratch-copy"]).ok).toBe(false);
    expect(rehearsalVerdict({ ...base, SCRATCH_CONFIRM: scratchConfirmPhrase("localhost") }, []).ok).toBe(false);
    expect(rehearsalVerdict(base, ["--scratch-copy"]).ok).toBe(false);
    expect(rehearsalVerdict({ ...base, SCRATCH_CONFIRM: scratchConfirmPhrase("localhost") }, ["--scratch-copy"]).ok).toBe(true);
  });
  it("snapshot names are validated", () => {
    expect(snapName("20261119", "visit")).toBe("_snap_20261119_visit");
    expect(() => snapshotStamp("2026; DROP TABLE x")).toThrow();
    expect(() => snapshotStamp("20261340")).toThrow();
  });
  it("every writing script goes through guard(); read-only ones declare readOnly", () => {
    const writers = ["unify-backfill", "unify-snapshot", "unify-copyback", "unify-rollback"];
    for (const n of writers) expect(readFileSync(`scripts/${n}.ts`, "utf8")).toMatch(/guard\(\{ name: "[a-z-]+"/);
    for (const n of ["unify-dryrun", "unify-fingerprint", "unify-verify"]) expect(readFileSync(`scripts/${n}.ts`, "utf8")).toContain("readOnly: true");
    expect(readFileSync("scripts/unify-seed-fake.ts", "utf8")).toContain("neverProd: true");
    expect(readFileSync("scripts/unify-rehearse.ts", "utf8")).toContain("rehearsalVerdict");
  });
  it("the backfill dry-runs by default and production apply demands the dry-run's insert count", () => {
    const s = readFileSync("scripts/unify-backfill.ts", "utf8");
    expect(s).toContain('readOnly: !apply');
    expect(s).toContain("--expect-inserts");
  });
});

describe("automatic gates", () => {
  const c = { patient: 5, visit: 6, visitWithTranscript: 6, visitDocument: 6, recordingInbox: 2, encounter: 1, scheduleEntry: 17, visitDocumentVersion: 0, documentVersion: 0, provider: 2 };
  const fp = { visitCount: 6, visitHash: "a", inboxCount: 2, inboxHash: "b" };
  const ok = { same: 6, changed: 0, missing: 0, added: 0 };
  const run = (over: Record<string, unknown> = {}) => postRunGates({ before: c, after: { ...c, visit: 9 }, fpBefore: fp, fpAfter: fp, visitDiff: { ...ok, added: 3 }, entryDiff: ok, inboxDiff: ok, expectInserts: 3, ...over } as never);
  it("green when nothing but the expected inserts changed", () => expect(allGreen(run())).toBe(true));
  it("red on a changed transcript fingerprint", () => expect(allGreen(run({ fpAfter: { ...fp, visitHash: "x" } }))).toBe(false));
  it("red when a ScheduleEntry count moves", () => expect(allGreen(run({ after: { ...c, visit: 9, scheduleEntry: 16 } }))).toBe(false));
  it("red when a Visit row differs from the snapshot", () => expect(allGreen(run({ visitDiff: { ...ok, changed: 1, added: 3 } }))).toBe(false));
  it("red when more Visits appear than planned", () => expect(allGreen(run({ after: { ...c, visit: 10 } }))).toBe(false));
  it("backup gate compares the five counts", () => {
    expect(backupGate(c, c).pass).toBe(true);
    expect(backupGate(c, { ...c, visitWithTranscript: 5 }).pass).toBe(false);
  });
});

describe("schema stays additive", () => {
  it("every new Visit column is nullable and the migration passes the additive gate", () => {
    const s = readFileSync("prisma/schema.prisma", "utf8");
    const block = /model Visit \{[\s\S]*?\n\}/.exec(s)![0];
    for (const col of ["legacyScheduleEntryId", "backfilledAt", "startTime", "endTime", "timeLabel", "section", "trackName", "providerId", "encounterId", "scheduleNotes", "discharged", "overdueBasis"]) {
      expect(block).toMatch(new RegExp(`\\n\\s+${col}\\s+(String|DateTime|Boolean)\\?`));
    }
    const sql = `ALTER TABLE "Visit" ADD COLUMN "backfilledAt" TIMESTAMP(3), ADD COLUMN "legacyScheduleEntryId" TEXT;
CREATE INDEX "Visit_providerId_idx" ON "Visit"("providerId");
ALTER TABLE "Visit" ADD CONSTRAINT "Visit_providerId_fkey" FOREIGN KEY ("providerId") REFERENCES "Provider"("id") ON DELETE SET NULL ON UPDATE CASCADE;`;
    expect(gateSchemaSql(sql)).toEqual([]);
  });
  it("migration-inserted Visits are hidden from every Visit list reader", () => {
    for (const f of ["src/lib/notes/queries.ts", "src/lib/notes/visitSearch.ts", "src/lib/notes/options.ts", "src/lib/notes/loadSchedule.ts", "src/app/api/desktop/v1/notes/visits/route.ts"]) {
      expect(readFileSync(f, "utf8")).toContain("LIVE_VISITS");
    }
  });
  it("the app still reads ScheduleEntry for the schedule (Release A switches no reader)", () => {
    expect(readFileSync("src/app/schedule/page.tsx", "utf8")).toContain("db.scheduleEntry.findMany");
    expect(readFileSync("src/app/api/desktop/v1/schedule/route.ts", "utf8")).toContain("db.scheduleEntry.findMany");
  });
});
