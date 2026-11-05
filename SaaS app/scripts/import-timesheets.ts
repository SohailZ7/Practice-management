// Imports timesheet entries and payments from a normalized JSON file. Idempotent: rows already present (same employee,
// date, start and end; same employee, date, amount and month for payments) are skipped, so running it twice adds nothing.
// Reads the JSON from the IMPORT_JSON environment variable (a mounted secret) or a file path argument. It prints counts and
// any differences between the source's minutes/charge and the computed ones, never the rows themselves.
//   npx tsx scripts/import-timesheets.ts [file.json] [--dry-run]
import { readFileSync } from "node:fs";
import { db } from "../src/lib/db";
import { audit } from "../src/lib/audit";
import { planImport, entryKey, paymentKey, type ImportFile } from "../src/lib/timesheets/importer";
import { ensureEmployees } from "../src/lib/timesheets/queries";
import { addPayment } from "../src/lib/timesheets/payments";
import { monthKey } from "../src/lib/timesheets/calc";

async function main() {
  const dry = process.argv.includes("--dry-run");
  const file = process.argv.find((a, i) => i >= 2 && !a.startsWith("--"));
  const raw = file ? readFileSync(file, "utf8") : process.env.IMPORT_JSON;
  if (!raw) throw new Error("Provide a JSON file path or set IMPORT_JSON.");
  const plan = planImport(JSON.parse(raw) as ImportFile);

  const admin = await db.user.findFirst({ where: { role: "ADMIN", active: true }, orderBy: { createdAt: "asc" } });
  if (!admin) throw new Error("No active admin to attribute the import to.");
  const actor = { id: admin.id, email: admin.email };

  const employees = await ensureEmployees();
  const byName = new Map(employees.map((e) => [e.name.toLowerCase(), e]));
  const perMonth: Record<string, number> = {};
  let skipped = 0;
  let payAdded = 0;
  let paySkipped = 0;

  for (const pe of plan.employees) {
    const emp = byName.get(pe.name.toLowerCase());
    if (!emp) {
      plan.errors.push(`${pe.name}: no such timesheet employee`);
      continue;
    }
    const have = new Set((await db.timesheetEntry.findMany({ where: { employeeId: emp.id } })).map((r) => entryKey(emp.id, r)));
    for (const e of pe.entries) {
      if (have.has(entryKey(emp.id, e))) {
        skipped++;
        continue;
      }
      if (!dry) await db.timesheetEntry.create({ data: { ...e, employeeId: emp.id, createdById: actor.id } });
      have.add(entryKey(emp.id, e));
      const k = `${emp.name} ${monthKey(e.date)}`;
      perMonth[k] = (perMonth[k] ?? 0) + 1;
    }
    const havePay = new Set((await db.timesheetPayment.findMany({ where: { employeeId: emp.id } })).map((p) => paymentKey(emp.id, p)));
    for (const p of pe.payments) {
      if (havePay.has(paymentKey(emp.id, p))) {
        paySkipped++;
        continue;
      }
      if (!dry) await addPayment(actor, emp.id, { ...p, note: p.note || "Imported from timesheet sheet" }, null);
      havePay.add(paymentKey(emp.id, p));
      payAdded++;
    }
  }

  console.log(`${dry ? "DRY RUN. " : ""}entries added by employee and month:`, JSON.stringify(perMonth));
  console.log(`entries skipped as already present: ${skipped}; payments added: ${payAdded}, skipped: ${paySkipped}`);
  console.log(`discrepancies (source vs computed): ${plan.discrepancies.length}`);
  for (const d of plan.discrepancies) console.log(`  ${d.employee} ${d.date} ${d.start}-${d.end} ${d.field}: computed ${d.computed}, source ${d.sheet}`);
  console.log(`errors: ${plan.errors.length}`);
  for (const e of plan.errors) console.log(`  ${e}`);
  if (!dry) await audit(actor.email, "timesheet.import", `entries ${Object.values(perMonth).reduce((a, b) => a + b, 0)} skipped ${skipped} payments ${payAdded}`);
}

main()
  .catch((e) => {
    console.error("import failed:", e instanceof Error ? e.message : "unknown error");
    process.exitCode = 1;
  })
  .finally(() => db.$disconnect());
