// Release B2a: copy the schedule rows that have no patient from ScheduleEntry into UnmatchedAppointment, then prove the
// copy. Raw SQL on stored values (the encrypted clientInfo is copied as is, no key needed). Counts only, no row content.

type Db = {
  $queryRawUnsafe: <T>(sql: string) => Promise<T>;
  $executeRawUnsafe: (sql: string) => Promise<number>;
};

export const COLS = ["id", "date", "section", "timeLabel", "trackName", "typeName", "clientInfo", "providerId", "providerName", "absent", "canceled", "completed", "missed", "dedupeKey", "importLogId", "patientId", "createdAt"] as const;
const list = (a: string) => COLS.map((c) => `${a}."${c}"`).join(", ");
// Rows to carry over: every ScheduleEntry that is not already a Visit. That is the no-patient rows, plus (should any exist)
// a row with a patient that no Visit carries, so the drop can never lose an appointment.
const SRC = `"ScheduleEntry" s WHERE (s."patientId" IS NULL OR NOT EXISTS (SELECT 1 FROM "Visit" v WHERE v."legacyScheduleEntryId" = s."id" OR v."id" = s."visitId"))`;

const one = async (db: Db, sql: string) => Number((await db.$queryRawUnsafe<{ n: bigint | number }[]>(sql))[0].n);

export type UnmatchedReport = {
  sourceNoPatient: number; // ScheduleEntry rows that are not a Visit (no patient, or no Visit carries them): must all be accounted for
  withPatient: number; // of those, rows that have a patient (informational)
  inTarget: number; // of those, rows now in UnmatchedAppointment (same id)
  linkedToVisit: number; // of the rest, rows a Visit already carries (a patient was linked after the copy)
  unaccounted: number; // in neither: must be 0 before the drop
  contentDiffers: number; // same id in both but any column differs: must be 0
  targetTotal: number;
};

export async function copyUnmatched(db: Db): Promise<number> {
  return db.$executeRawUnsafe(`INSERT INTO "UnmatchedAppointment" (${COLS.map((c) => `"${c}"`).join(", ")}) SELECT ${list("s")} FROM ${SRC} ON CONFLICT ("id") DO NOTHING`);
}

export async function verifyUnmatched(db: Db): Promise<UnmatchedReport> {
  const differs = COLS.filter((c) => c !== "id").map((c) => `s."${c}" IS DISTINCT FROM u."${c}"`).join(" OR ");
  return {
    sourceNoPatient: await one(db, `SELECT count(*) n FROM ${SRC}`),
    inTarget: await one(db, `SELECT count(*) n FROM ${SRC} AND EXISTS (SELECT 1 FROM "UnmatchedAppointment" u WHERE u."id" = s."id")`),
    linkedToVisit: await one(db, `SELECT count(*) n FROM ${SRC} AND NOT EXISTS (SELECT 1 FROM "UnmatchedAppointment" u WHERE u."id" = s."id") AND EXISTS (SELECT 1 FROM "Visit" v WHERE v."legacyScheduleEntryId" = s."id")`),
    unaccounted: await one(db, `SELECT count(*) n FROM ${SRC} AND NOT EXISTS (SELECT 1 FROM "UnmatchedAppointment" u WHERE u."id" = s."id") AND NOT EXISTS (SELECT 1 FROM "Visit" v WHERE v."legacyScheduleEntryId" = s."id")`),
    contentDiffers: await one(db, `SELECT count(*) n FROM "ScheduleEntry" s JOIN "UnmatchedAppointment" u ON u."id" = s."id" WHERE ${differs.length ? `(${differs})` : "false"}`),
    withPatient: await one(db, `SELECT count(*) n FROM ${SRC} AND s."patientId" IS NOT NULL`),
    targetTotal: await one(db, `SELECT count(*) n FROM "UnmatchedAppointment"`),
  };
}

/** The drop is allowed only when everything is accounted for and nothing differs. Pure, tested. */
export function dropReady(r: UnmatchedReport): { ok: boolean; why: string[] } {
  const why: string[] = [];
  if (r.unaccounted !== 0) why.push(`${r.unaccounted} schedule rows are in neither the new table nor a Visit`);
  if (r.contentDiffers !== 0) why.push(`${r.contentDiffers} copied rows differ from their source`);
  if (r.inTarget + r.linkedToVisit !== r.sourceNoPatient) why.push("copy counts do not add up");
  return { ok: why.length === 0, why };
}
