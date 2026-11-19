// Unification, Release A: the database side of counts, fingerprint, snapshot, backfill, verify, copy-back and rollback.
// Uses a plain PrismaClient on purpose: nothing here may read or write through the encryption layer, and transcripts are
// only ever hashed as STORED (so a rewrite is visible). Output is counts and hashes, never row contents.

import { Prisma, PrismaClient } from "@prisma/client";
import { planBackfill, type Plan } from "./plan";
import { snapName, snapshotStamp } from "./guards";

export type Counts = Record<string, number>;
export const MIGRATION_ACTOR = "system:unify-release-a";
const LOCK_KEY = 7311001; // one run at a time

const TABLES: [string, string][] = [
  ["patient", '"BillingPatient"'], ["visit", '"Visit"'], ["visitDocument", '"VisitDocument"'], ["recordingInbox", '"RecordingInbox"'],
  ["encounter", '"Encounter"'], ["scheduleEntry", '"ScheduleEntry"'], ["visitDocumentVersion", '"VisitDocumentVersion"'],
  ["documentVersion", '"DocumentVersion"'], ["provider", '"Provider"'],
];

const num = (v: unknown) => Number(v);

export async function tableCounts(db: PrismaClient): Promise<Counts> {
  const out: Counts = {};
  for (const [k, t] of TABLES) out[k] = num((await db.$queryRawUnsafe<{ n: bigint }[]>(`SELECT count(*) AS n FROM ${t}`))[0].n);
  out.visitWithTranscript = num((await db.$queryRawUnsafe<{ n: bigint }[]>(`SELECT count(*) AS n FROM "Visit" WHERE transcript <> ''`))[0].n);
  return out;
}

async function hasColumn(db: PrismaClient, table: string, column: string) {
  const r = await db.$queryRaw<{ n: bigint }[]>`SELECT count(*) AS n FROM information_schema.columns WHERE table_name = ${table} AND column_name = ${column}`;
  return num(r[0].n) > 0;
}

const SHA = (expr: string) => `encode(sha256(convert_to(${expr}, 'UTF8')), 'hex')`;

export type Fingerprint = { visitCount: number; visitHash: string; inboxCount: number; inboxHash: string };
/** Hash of every Visit id + stored transcript (migration-inserted Visits excluded, they have no transcript) and of every RecordingInbox row (id, seq, final, text, checksum; the visit link is excluded so linking later is not a change). */
export async function fingerprint(db: PrismaClient): Promise<Fingerprint> {
  const filter = (await hasColumn(db, "Visit", "backfilledAt")) ? `WHERE "backfilledAt" IS NULL` : "";
  const v = await db.$queryRawUnsafe<{ n: bigint; h: string }[]>(
    `SELECT count(*) AS n, ${SHA(`coalesce(string_agg(r, '' ORDER BY id), '')`)} AS h FROM (SELECT id, ${SHA(`id || chr(31) || transcript`)} AS r FROM "Visit" ${filter}) t`);
  const i = await db.$queryRawUnsafe<{ n: bigint; h: string }[]>(
    `SELECT count(*) AS n, ${SHA(`coalesce(string_agg(r, '' ORDER BY id), '')`)} AS h FROM (SELECT id, ${SHA(`id || chr(31) || seq::text || chr(31) || final::text || chr(31) || text || chr(31) || sha256`)} AS r FROM "RecordingInbox") t`);
  return { visitCount: num(v[0].n), visitHash: v[0].h, inboxCount: num(i[0].n), inboxHash: i[0].h };
}

// ---- snapshot ---------------------------------------------------------------------------------------------------
const VISIT_COLS = ["id", "patientId", "visitDate", "appointmentType", "program", "apptTime", "providerName", "status", "transcript", "transcriptAt", "createdByEmail", "createdAt"];
const ENTRY_COLS = ["id", "date", "section", "timeLabel", "trackName", "typeName", "clientInfo", "providerId", "providerName", "absent", "canceled", "completed", "missed", "dedupeKey", "importLogId", "patientId", "visitId", "createdAt"];
const q = (cols: string[], alias = "") => cols.map((c) => `${alias}"${c}"`).join(", ");
const rowHashExpr = (cols: string[], alias = "") => SHA(`ROW(${q(cols, alias)})::text`);
export const SNAPSHOT_SOURCES = {
  visit: { table: '"Visit"', cols: VISIT_COLS },
  scheduleentry: { table: '"ScheduleEntry"', cols: ENTRY_COLS },
  inbox: { table: '"RecordingInbox"', cols: ["id", "seq", "final", "text", "sha256"] },
} as const;

async function tableExists(db: PrismaClient, name: string) {
  const r = await db.$queryRaw<{ n: bigint }[]>`SELECT count(*) AS n FROM information_schema.tables WHERE table_name = ${name}`;
  return num(r[0].n) > 0;
}

export type SnapshotMeta = { stamp: string; visitRows: number; entryRows: number; inboxRows: number; visitHash: string; entryHash: string; inboxHash: string; keepUntil: string };

/** Named (not temporary) snapshot tables, copy of the old columns plus a per-row hash. Refuses to overwrite. Keep them at least 7 days. */
export async function takeSnapshot(db: PrismaClient, stampRaw: string): Promise<SnapshotMeta> {
  const stamp = snapshotStamp(stampRaw);
  for (const w of ["visit", "scheduleentry", "inbox", "meta"] as const) if (await tableExists(db, snapName(stamp, w))) throw new Error(`snapshot ${stamp} already exists (never overwritten)`);
  await db.$transaction(async (tx) => {
    for (const w of ["visit", "scheduleentry", "inbox"] as const) {
      const s = SNAPSHOT_SOURCES[w];
      await tx.$executeRawUnsafe(`CREATE TABLE "${snapName(stamp, w)}" AS SELECT ${q([...s.cols])}, ${rowHashExpr([...s.cols])} AS "rowHash" FROM ${s.table}`);
      await tx.$executeRawUnsafe(`ALTER TABLE "${snapName(stamp, w)}" ADD PRIMARY KEY ("id")`);
    }
    const agg = (w: "visit" | "scheduleentry" | "inbox") => `(SELECT ${SHA(`coalesce(string_agg("rowHash", '' ORDER BY id), '')`)} FROM "${snapName(stamp, w)}")`;
    const cnt = (w: "visit" | "scheduleentry" | "inbox") => `(SELECT count(*) FROM "${snapName(stamp, w)}")`;
    await tx.$executeRawUnsafe(`CREATE TABLE "${snapName(stamp, "meta")}" AS SELECT now() AS "createdAt", now() + interval '7 days' AS "keepUntil",
      ${cnt("visit")}::int AS "visitRows", ${cnt("scheduleentry")}::int AS "entryRows", ${cnt("inbox")}::int AS "inboxRows",
      ${agg("visit")} AS "visitHash", ${agg("scheduleentry")} AS "entryHash", ${agg("inbox")} AS "inboxHash"`);
  });
  return readSnapshotMeta(db, stamp);
}

export async function readSnapshotMeta(db: PrismaClient, stampRaw: string): Promise<SnapshotMeta> {
  const stamp = snapshotStamp(stampRaw);
  const r = await db.$queryRawUnsafe<Record<string, unknown>[]>(`SELECT * FROM "${snapName(stamp, "meta")}"`);
  const m = r[0];
  return { stamp, visitRows: num(m.visitRows), entryRows: num(m.entryRows), inboxRows: num(m.inboxRows), visitHash: String(m.visitHash), entryHash: String(m.entryHash), inboxHash: String(m.inboxHash), keepUntil: new Date(m.keepUntil as Date).toISOString() };
}

export type RowDiff = { same: number; changed: number; missing: number; added: number };
/** Live rows against the snapshot, by row hash. `changed` rows differ, `missing` rows are gone, `added` rows are new since the snapshot. */
export async function diffAgainstSnapshot(db: PrismaClient, stampRaw: string, what: "visit" | "scheduleentry" | "inbox"): Promise<RowDiff> {
  const stamp = snapshotStamp(stampRaw);
  const s = SNAPSHOT_SOURCES[what];
  const r = await db.$queryRawUnsafe<{ same: bigint; changed: bigint; missing: bigint; added: bigint }[]>(
    `SELECT count(*) FILTER (WHERE l.id IS NOT NULL AND sn.id IS NOT NULL AND l.h = sn."rowHash") AS same,
            count(*) FILTER (WHERE l.id IS NOT NULL AND sn.id IS NOT NULL AND l.h <> sn."rowHash") AS changed,
            count(*) FILTER (WHERE l.id IS NULL) AS missing, count(*) FILTER (WHERE sn.id IS NULL) AS added
     FROM (SELECT id, ${rowHashExpr([...s.cols])} AS h FROM ${s.table}) l FULL JOIN "${snapName(stamp, what)}" sn ON sn.id = l.id`);
  return { same: num(r[0].same), changed: num(r[0].changed), missing: num(r[0].missing), added: num(r[0].added) };
}

/** Copy back ONLY rows whose hash differs from the snapshot, column by column from the snapshot (never truncate and reload). Rows that are gone cannot be restored here (their documents cascaded): reported as `missing`. */
export async function copyBackDiffering(db: PrismaClient, stampRaw: string): Promise<{ visit: number; scheduleentry: number; missing: { visit: number; scheduleentry: number } }> {
  const stamp = snapshotStamp(stampRaw);
  const out = { visit: 0, scheduleentry: 0, missing: { visit: 0, scheduleentry: 0 } };
  for (const w of ["visit", "scheduleentry"] as const) {
    const s = SNAPSHOT_SOURCES[w];
    const setCols = s.cols.filter((c) => c !== "id");
    const set = setCols.map((c) => `"${c}" = sn."${c}"`).join(", ");
    const n = await db.$executeRawUnsafe(
      `UPDATE ${s.table} AS t SET ${set} FROM "${snapName(stamp, w)}" sn WHERE sn.id = t.id AND ${rowHashExpr([...s.cols], "t.")} <> sn."rowHash"`);
    out[w] = n;
    const d = await diffAgainstSnapshot(db, stamp, w);
    out.missing[w] = d.missing;
  }
  return out;
}

// ---- backfill ---------------------------------------------------------------------------------------------------
export async function loadPlan(db: PrismaClient): Promise<Plan> {
  const [entries, visits, providers, patients] = await Promise.all([
    db.scheduleEntry.findMany({ select: { id: true, date: true, section: true, timeLabel: true, trackName: true, typeName: true, providerId: true, providerName: true, absent: true, canceled: true, completed: true, missed: true, patientId: true, visitId: true, createdAt: true } }),
    db.visit.findMany({ select: { id: true, patientId: true, visitDate: true, providerName: true, backfilledAt: true, legacyScheduleEntryId: true, startTime: true, endTime: true, timeLabel: true, section: true, trackName: true, providerId: true } }),
    db.provider.findMany({ select: { id: true, name: true, trackingOnly: true } }),
    db.patient.findMany({ select: { id: true, mergedIntoId: true } }),
  ]);
  return planBackfill({ entries, visits, providers, patients });
}

/** Applies the plan in ONE transaction (all or nothing), holding an advisory lock. Fills use COALESCE so a column that got a value meanwhile is never overwritten. Touches no transcript, status or patient. */
export async function applyPlan(db: PrismaClient, plan: Plan): Promise<{ filled: number; inserted: number }> {
  return db.$transaction(async (tx) => {
    const lock = await tx.$queryRaw<{ ok: boolean }[]>`SELECT pg_try_advisory_xact_lock(${LOCK_KEY}) AS ok`;
    if (!lock[0].ok) throw new Error("another unify run holds the lock");
    let filled = 0;
    for (const f of plan.fills) {
      const cols = Object.keys(f.patch);
      const set = cols.map((c, i) => `"${c}" = COALESCE("${c}", $${i + 2})`).join(", ");
      filled += await tx.$executeRawUnsafe(`UPDATE "Visit" SET ${set} WHERE id = $1`, f.visitId, ...cols.map((c) => (f.patch as Record<string, unknown>)[c]));
    }
    let inserted = 0;
    for (const i of plan.inserts) {
      // Idempotent: skip when a Visit already carries this entry id (a second run, or a concurrent one).
      const exists = await tx.$queryRaw<{ n: bigint }[]>`SELECT count(*) AS n FROM "Visit" WHERE "legacyScheduleEntryId" = ${i.legacyScheduleEntryId}`;
      if (num(exists[0].n) > 0) continue;
      await tx.visit.create({
        data: {
          patientId: i.patientId, visitDate: i.visitDate, appointmentType: i.appointmentType, program: i.program, apptTime: i.apptTime,
          providerName: i.providerName, status: i.status, createdByEmail: MIGRATION_ACTOR, backfilledAt: new Date(),
          legacyScheduleEntryId: i.legacyScheduleEntryId, startTime: i.startTime, endTime: i.endTime, timeLabel: i.timeLabel,
          section: i.section, trackName: i.trackName, providerId: i.providerId,
        },
      });
      inserted++;
    }
    return { filled, inserted };
  }, { timeout: 600_000, maxWait: 30_000 });
}

/** Rollback of Release A: removes ONLY Visits the migration inserted that still have no transcript, no documents, no inbox link and no consent row; nulls the columns Release A filled on existing Visits. Never touches anything else. */
export async function rollbackRelease(db: PrismaClient): Promise<{ deleted: number; keptInUse: number; cleared: number }> {
  return db.$transaction(async (tx) => {
    const del = await tx.$executeRawUnsafe(`DELETE FROM "Visit" v WHERE v."backfilledAt" IS NOT NULL AND v.transcript = ''
      AND NOT EXISTS (SELECT 1 FROM "VisitDocument" d WHERE d."visitId" = v.id)
      AND NOT EXISTS (SELECT 1 FROM "RecordingInbox" i WHERE i."visitId" = v.id)
      AND NOT EXISTS (SELECT 1 FROM "RecordingConsent" c WHERE c."visitId" = v.id)`);
    const kept = num((await tx.$queryRawUnsafe<{ n: bigint }[]>(`SELECT count(*) AS n FROM "Visit" WHERE "backfilledAt" IS NOT NULL`))[0].n);
    const cleared = await tx.$executeRawUnsafe(`UPDATE "Visit" SET "legacyScheduleEntryId" = NULL, "startTime" = NULL, "endTime" = NULL, "timeLabel" = NULL, "section" = NULL, "trackName" = NULL, "providerId" = NULL
      WHERE "backfilledAt" IS NULL AND "legacyScheduleEntryId" IS NOT NULL`);
    return { deleted: del, keptInUse: kept, cleared };
  });
}

export { Prisma };
