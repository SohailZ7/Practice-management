// Encrypts existing plaintext PHI columns in place (idempotent), re-keys after a key rotation, or rolls back.
//
//   npm run db:encrypt-phi -- --database <name> [--dry-run]            encrypt what is still plaintext
//   npm run db:encrypt-phi -- --database <name> --rekey                re-encrypt with the current key + recompute dedupe keys
//   npm run db:encrypt-phi -- --database <name> --decrypt              roll back to plaintext (for rollback only)
//
// --database must equal the database name in DATABASE_URL: a guard against running it on the wrong database.
// Back up first. Needs PHI_ENCRYPTION_KEY (and PHI_ENCRYPTION_PREVIOUS_KEYS when re-keying or decrypting old values).
// Uses a plain Prisma client on purpose, so it sees the stored (possibly encrypted) text.

import { PrismaClient } from "@prisma/client";
import { phi } from "../src/lib/crypto/phi";
import { planScheduleEntry, planValue, type Mode } from "../src/lib/crypto/backfill";

const BATCH = 500;
const argv = process.argv.slice(2);
const flag = (name: string) => argv.includes(`--${name}`);
const mode: Mode = flag("decrypt") ? "decrypt" : flag("rekey") ? "rekey" : "encrypt";
const dryRun = flag("dry-run");

function databaseName(): string {
  try {
    return new URL(process.env.DATABASE_URL ?? "").pathname.replace(/^\//, "");
  } catch {
    return "";
  }
}

async function main() {
  const wanted = argv[argv.indexOf("--database") + 1];
  const actual = databaseName();
  if (!flag("database") || !wanted || wanted !== actual) {
    throw new Error(`Refusing to run: pass --database ${actual || "<name>"} (the database in DATABASE_URL) to confirm the target.`);
  }
  if (flag("decrypt") && flag("rekey")) throw new Error("Choose --decrypt or --rekey, not both.");
  const cipher = phi();
  const db = new PrismaClient({ errorFormat: "minimal", log: ["error"] });
  const counts = new Map<string, { scanned: number; changed: number }>();
  const bump = (k: string, changed: boolean) => {
    const c = counts.get(k) ?? { scanned: 0, changed: 0 };
    c.scanned++;
    if (changed) c.changed++;
    counts.set(k, c);
  };

  try {
    // ScheduleEntry: clientInfo + dedupeKey together.
    for (let cursor: string | undefined; ; ) {
      const rows = await db.scheduleEntry.findMany({
        take: BATCH,
        ...(cursor ? { skip: 1, cursor: { id: cursor } } : {}),
        orderBy: { id: "asc" },
        select: { id: true, clientInfo: true, dedupeKey: true, date: true, section: true, timeLabel: true, providerName: true },
      });
      if (rows.length === 0) break;
      const updates = rows.map((r) => ({ id: r.id, data: planScheduleEntry(cipher, r, mode) }));
      rows.forEach((_, i) => bump("ScheduleEntry", Object.keys(updates[i].data).length > 0));
      const todo = updates.filter((u) => Object.keys(u.data).length > 0);
      if (!dryRun && todo.length) await db.$transaction(todo.map((u) => db.scheduleEntry.update({ where: { id: u.id }, data: u.data })));
      cursor = rows[rows.length - 1].id;
    }

    // The other encrypted columns, one model at a time.
    const simple = [
      { name: "Provider.zoomPassword", model: "Provider", field: "zoomPassword", find: (a: object) => db.provider.findMany(a), update: (id: string, v: string) => db.provider.update({ where: { id }, data: { zoomPassword: v } }) },
      { name: "Task.notes", model: "Task", field: "notes", find: (a: object) => db.task.findMany(a), update: (id: string, v: string) => db.task.update({ where: { id }, data: { notes: v }, select: { id: true } }) },
      { name: "ImportDraft.payload", model: "ImportDraft", field: "payload", find: (a: object) => db.importDraft.findMany(a), update: (id: string, v: string) => db.importDraft.update({ where: { id }, data: { payload: v } }) },
    ];
    for (const t of simple) {
      for (let cursor: string | undefined; ; ) {
        const rows = (await t.find({
          take: BATCH,
          ...(cursor ? { skip: 1, cursor: { id: cursor } } : {}),
          orderBy: { id: "asc" },
          select: { id: true, [t.field]: true },
        })) as ({ id: string } & Record<string, string>)[];
        if (rows.length === 0) break;
        const todo: { id: string; value: string }[] = [];
        for (const r of rows) {
          const next = planValue(cipher, t.model, t.field, r[t.field], mode);
          bump(t.name, next !== null);
          if (next !== null) todo.push({ id: r.id, value: next });
        }
        if (!dryRun && todo.length) await db.$transaction(todo.map((u) => t.update(u.id, u.value)));
        cursor = rows[rows.length - 1].id;
      }
    }
  } finally {
    await db.$disconnect();
  }

  console.log(`${dryRun ? `[dry run] would ${mode}` : mode} on database "${actual}"`);
  for (const [k, c] of counts) console.log(`  ${k}: ${c.changed} changed of ${c.scanned} rows`);
}

main().catch((e) => {
  console.error(e instanceof Error ? e.message : "failed");
  process.exit(1);
});
