// End-to-end check of field encryption against a real database: the app client round-trips plaintext, the stored text
// is ciphertext, re-import stays idempotent, and `db:encrypt-phi` is idempotent and reversible.
// Writes synthetic rows prefixed "ZZ" and removes them. It adds a couple of audit rows (those cannot be deleted).
//   npm run verify:phi -- --database <name>

import { execFileSync } from "node:child_process";
import { PrismaClient } from "@prisma/client";
import { createDb } from "../src/lib/db";
import { commitImport } from "../src/lib/import/service";
import { legacyDedupeKey, makeDedupeKey, type ParseResult } from "../src/lib/import/outpatientBoard";
import { isKeyedDedupe } from "../src/lib/crypto/phi";

const dbName = new URL(process.env.DATABASE_URL ?? "postgres://x/").pathname.slice(1);
const argv = process.argv.slice(2);
if (argv[argv.indexOf("--database") + 1] !== dbName) {
  console.error(`Refusing to run: pass --database ${dbName} to confirm the target.`);
  process.exit(1);
}

const app = createDb();
const raw = new PrismaClient();
let failures = 0;
const check = (name: string, ok: boolean, extra = "") => {
  if (!ok) failures++;
  console.log(`${ok ? "PASS" : "FAIL"}  ${name}${ok || !extra ? "" : `  (${extra})`}`);
};
const backfill = (...flags: string[]) =>
  execFileSync("npx", ["tsx", "scripts/encrypt-phi.ts", "--database", dbName, ...flags], { encoding: "utf8" });
const changed = (out: string) => [...out.matchAll(/: (\d+) changed of/g)].reduce((n, m) => n + Number(m[1]), 0);

const entry = (date: string, client: string) => ({
  date, section: "TRACK" as const, timeLabel: "ZZ Track 8:30 - 11:00", trackName: "ZZ Track", typeName: "", clientInfo: client,
  providerName: "ZZ Provider", absent: false, canceled: false, completed: false, missed: false, dedupeKey: "",
});

async function cleanup() {
  await raw.scheduleEntry.deleteMany({ where: { OR: [{ providerName: "ZZ Provider" }, { timeLabel: { startsWith: "ZZ" } }] } });
  await raw.importLog.deleteMany({ where: { fileName: { startsWith: "ZZ" } } });
  await raw.importDraft.deleteMany({ where: { fileName: { startsWith: "ZZ" } } });
  await raw.task.deleteMany({ where: { title: { startsWith: "ZZ" } } });
  await raw.provider.deleteMany({ where: { name: { startsWith: "ZZ" } } });
}

async function main() {
  await cleanup();

  // 1. Transparent encryption through the app client.
  const provider = await app.provider.create({ data: { name: "ZZ Provider", zoomPassword: "zz-zoom-pass" } });
  const e = entry("2026-01-05", "ZZ Verify, Patient");
  const created = await app.scheduleEntry.create({
    data: { ...e, providerId: provider.id, dedupeKey: makeDedupeKey(e) },
    include: { provider: true },
  });
  check("create returns plaintext clientInfo", created.clientInfo === "ZZ Verify, Patient");
  check("nested provider.zoomPassword is decrypted", created.provider?.zoomPassword === "zz-zoom-pass");
  const rawEntry = (await raw.$queryRaw<{ clientInfo: string; dedupeKey: string }[]>`SELECT "clientInfo","dedupeKey" FROM "ScheduleEntry" WHERE id = ${created.id}`)[0];
  check("stored clientInfo is ciphertext", rawEntry.clientInfo.startsWith("phi:v1:") && !rawEntry.clientInfo.includes("Verify"));
  check("stored dedupeKey has no client text", isKeyedDedupe(rawEntry.dedupeKey) && !rawEntry.dedupeKey.toLowerCase().includes("verify"));
  const rawProv = (await raw.$queryRaw<{ zoomPassword: string }[]>`SELECT "zoomPassword" FROM "Provider" WHERE id = ${provider.id}`)[0];
  check("stored zoomPassword is ciphertext", rawProv.zoomPassword.startsWith("phi:v1:"));

  const upd = await app.scheduleEntry.update({ where: { id: created.id }, data: { clientInfo: "ZZ Verify, Changed" } });
  check("update encrypts and returns plaintext", upd.clientInfo === "ZZ Verify, Changed");
  const many = await app.scheduleEntry.findMany({ where: { providerName: "ZZ Provider" } });
  check("findMany decrypts", many.length === 1 && many[0].clientInfo === "ZZ Verify, Changed");
  let refused = false;
  try {
    await app.scheduleEntry.findMany({ where: { clientInfo: { contains: "Verify" } } });
  } catch {
    refused = true;
  }
  check("filtering on an encrypted column is refused", refused);

  const task = await app.task.create({ data: { title: "ZZ task", notes: "ZZ private note" } });
  const rawTask = (await raw.$queryRaw<{ notes: string }[]>`SELECT notes FROM "Task" WHERE id = ${task.id}`)[0];
  check("Task.notes stored as ciphertext", rawTask.notes.startsWith("phi:v1:"));
  check("Task.notes read back as plaintext", (await app.task.findUnique({ where: { id: task.id } }))?.notes === "ZZ private note");
  const emptyTask = await app.task.create({ data: { title: "ZZ empty" } });
  check("empty notes stay empty", emptyTask.notes === "");

  // 2. Import stays idempotent when dedupe keys are keyed hashes.
  const parsed: ParseResult = { providers: [], skipped: 0, warnings: [], entries: [entry("2026-01-06", "ZZ Import One"), entry("2026-01-07", "ZZ Import Two")] };
  for (const p of parsed.entries) p.dedupeKey = makeDedupeKey(p);
  const options = { includeProviders: false, overwriteZoomPassword: false, mapping: {} };
  const runImport = async () => {
    const draft = await app.importDraft.create({ data: { userEmail: "zz@example.test", fileName: "ZZ.xlsx", sheet: "ZZ", payload: JSON.stringify(parsed) } });
    const rawDraft = (await raw.$queryRaw<{ payload: string }[]>`SELECT payload FROM "ImportDraft" WHERE id = ${draft.id}`)[0];
    check("ImportDraft.payload stored as ciphertext", rawDraft.payload.startsWith("phi:v1:") && !rawDraft.payload.includes("Import One"));
    const result = await commitImport({ draftId: draft.id, userEmail: "zz@example.test", options });
    check("draft deleted right after commit", (await raw.importDraft.count({ where: { id: draft.id } })) === 0);
    return result;
  };
  const first = await runImport();
  const second = await runImport();
  check("first import adds both rows", first.created === 2 && first.duplicates === 0, JSON.stringify(first));
  check("re-importing the same sheet adds nothing", second.created === 0 && second.duplicates === 2, JSON.stringify(second));

  // 3. Backfill of legacy plaintext rows: idempotent and reversible.
  const legacy = entry("2026-01-08", "ZZ Legacy Client");
  const legacyKey = legacyDedupeKey(legacy);
  const lid = "zz-legacy-entry";
  await raw.$executeRaw`INSERT INTO "ScheduleEntry"(id,date,section,"timeLabel","trackName","typeName","clientInfo","providerName","dedupeKey") VALUES (${lid},${legacy.date},${legacy.section},${legacy.timeLabel},'ZZ Track','',${legacy.clientInfo},'ZZ Provider',${legacyKey})`;
  const tid = "zz-legacy-task";
  await raw.$executeRaw`INSERT INTO "Task"(id,title,notes,"sortOrder") VALUES (${tid},'ZZ legacy task','ZZ legacy note',9999)`;
  const dry = backfill("--dry-run");
  check("dry run reports changes but writes none", changed(dry) >= 2 && (await raw.task.findUnique({ where: { id: tid } }))?.notes === "ZZ legacy note");
  const run1 = backfill();
  const afterRow = (await raw.$queryRaw<{ clientInfo: string; dedupeKey: string }[]>`SELECT "clientInfo","dedupeKey" FROM "ScheduleEntry" WHERE id = ${lid}`)[0];
  check("backfill encrypts clientInfo", afterRow.clientInfo.startsWith("phi:v1:"));
  check("backfill rewrites the dedupe key (matches what an import computes)", afterRow.dedupeKey === makeDedupeKey(legacy), afterRow.dedupeKey);
  check("backfill encrypts Task.notes", (await raw.task.findUnique({ where: { id: tid } }))!.notes.startsWith("phi:v1:"));
  check("backfill reported changes", changed(run1) >= 2, run1);
  const run2 = backfill();
  check("second backfill changes nothing (idempotent)", changed(run2) === 0, run2);
  const back = backfill("--decrypt");
  const plainRow = (await raw.$queryRaw<{ clientInfo: string; dedupeKey: string }[]>`SELECT "clientInfo","dedupeKey" FROM "ScheduleEntry" WHERE id = ${lid}`)[0];
  check("--decrypt restores plaintext and the old dedupe key", plainRow.clientInfo === legacy.clientInfo && plainRow.dedupeKey === legacyKey, back);
  check("--decrypt twice changes nothing", changed(backfill("--decrypt")) === 0);
  backfill();
  check("re-encrypting after rollback works", (await raw.task.findUnique({ where: { id: tid } }))!.notes.startsWith("phi:v1:"));
  check("--rekey with the same key changes nothing", changed(backfill("--rekey")) === 0);
}

main()
  .catch((e) => {
    console.error(e instanceof Error ? e.message : e);
    failures++;
  })
  .finally(async () => {
    await cleanup();
    await raw.$disconnect();
    console.log(failures === 0 ? "\nAll PHI encryption checks passed." : `\n${failures} check(s) FAILED.`);
    process.exit(failures ? 1 : 0);
  });
