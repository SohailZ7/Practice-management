// The one import path, used by the Timesheets upload page and by scripts/import-timesheets.ts, on every environment.
// A dry run reads and plans only. Applying is idempotent: entries and payments already present (natural keys in importer.ts)
// are skipped, and each new payment creates its Ledger row exactly as a manual payment does.
import { db } from "../db";
import { audit } from "../audit";
import { ensureEmployees } from "./queries";
import { addPayment } from "./payments";
import { monthKey } from "./calc";
import { applyDateFixes, entryKey, paymentKey, planImport, type DateFix, type Discrepancy, type ImportFile, type NeedsDate } from "./importer";

export const MAX_IMPORT_BYTES = 500_000;

export type ImportReport = {
  applied: boolean;
  fatal?: string;
  entries: { employee: string; month: string; add: number; present: number }[];
  payments: { employee: string; add: number; present: number }[];
  needsDate: NeedsDate[];
  skippedByAdmin: number;
  discrepancies: Discrepancy[];
  errors: string[];
};

const empty = (applied: boolean, fatal?: string): ImportReport => ({ applied, fatal, entries: [], payments: [], needsDate: [], skippedByAdmin: 0, discrepancies: [], errors: [] });

export function parseImportFile(text: string): ImportFile | string {
  if (text.length > MAX_IMPORT_BYTES) return "That file is too large for a timesheet import.";
  try {
    const v = JSON.parse(text) as ImportFile;
    if (!v || !Array.isArray(v.employees)) return "That file is not a timesheet import (no employees list).";
    return v;
  } catch {
    return "That file is not valid JSON.";
  }
}

export async function runImport(actor: { id: string; email: string }, text: string, opts: { apply: boolean; fixes?: DateFix[] }): Promise<ImportReport> {
  const parsed = parseImportFile(text);
  if (typeof parsed === "string") return empty(false, parsed);
  const { file, skipped } = applyDateFixes(parsed, opts.fixes ?? []);
  const plan = planImport(file);
  const report: ImportReport = { ...empty(false), needsDate: plan.needsDate, skippedByAdmin: skipped, discrepancies: plan.discrepancies, errors: [...plan.errors] };

  if (opts.apply && (plan.needsDate.length || plan.errors.length)) {
    return { ...report, fatal: plan.needsDate.length ? "Enter a date for each row that needs one, or skip it, then confirm." : "Fix the listed errors, then confirm." };
  }

  const employees = await ensureEmployees();
  const byName = new Map(employees.map((e) => [e.name.toLowerCase(), e]));
  const perMonth = new Map<string, { employee: string; month: string; add: number; present: number }>();
  const bump = (employee: string, month: string, field: "add" | "present") => {
    const k = `${employee}|${month}`;
    const row = perMonth.get(k) ?? { employee, month, add: 0, present: 0 };
    row[field]++;
    perMonth.set(k, row);
  };

  const toCreate: { employeeId: string; date: string; startMin: number; endMin: number; rateCents: number }[] = [];
  const payRows: { employee: string; add: number; present: number }[] = [];
  const payToAdd: { employeeId: string; p: (typeof plan.employees)[number]["payments"][number] }[] = [];

  for (const pe of plan.employees) {
    const emp = byName.get(pe.name.toLowerCase());
    if (!emp) {
      report.errors.push(`${pe.name}: no such timesheet employee`);
      continue;
    }
    const have = new Set((await db.timesheetEntry.findMany({ where: { employeeId: emp.id } })).map((r) => entryKey(emp.id, r)));
    for (const e of pe.entries) {
      const k = entryKey(emp.id, e);
      if (have.has(k)) bump(emp.name, monthKey(e.date), "present");
      else {
        bump(emp.name, monthKey(e.date), "add");
        toCreate.push({ ...e, employeeId: emp.id });
        have.add(k); // a repeat of the same row inside one file is also only added once
      }
    }
    const havePay = new Set((await db.timesheetPayment.findMany({ where: { employeeId: emp.id } })).map((p) => paymentKey(emp.id, p)));
    const row = { employee: emp.name, add: 0, present: 0 };
    for (const p of pe.payments) {
      const k = paymentKey(emp.id, p);
      if (havePay.has(k)) row.present++;
      else {
        row.add++;
        payToAdd.push({ employeeId: emp.id, p });
        havePay.add(k);
      }
    }
    payRows.push(row);
  }
  report.entries = Array.from(perMonth.values()).sort((a, b) => a.employee.localeCompare(b.employee) || a.month.localeCompare(b.month));
  report.payments = payRows;

  if (opts.apply && !report.errors.length) {
    if (toCreate.length) await db.timesheetEntry.createMany({ data: toCreate.map((e) => ({ ...e, createdById: actor.id })) });
    for (const { employeeId, p } of payToAdd) await addPayment(actor, employeeId, { ...p, note: p.note || "Imported from timesheet sheet" }, null);
    report.applied = true;
    // Counts only: no dates, times or amounts in the audit log.
    await audit(actor.email, "timesheet.import", `entries added ${toCreate.length}, payments added ${payToAdd.length}, skipped by admin ${skipped}`);
  }
  return report;
}
