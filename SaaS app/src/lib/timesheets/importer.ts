// Pure planning for the timesheet import. Reads a normalized file (dates as YYYY-MM-DD, times like "5:27 PM", rates in
// dollars), recomputes minutes and charge, and reports where the source's own numbers differ. No database here.
import { isISODate } from "../dates";
import { chargeCents, entryError, minutesWorked, paymentError, parseRate, parseTime, type EntryInput, type PaymentInput } from "./calc";

export type ImportEntry = { date: string; start: string; end: string; rate: string | number; sheetMinutes?: number; sheetChargeCents?: number };
export type ImportPayment = { date: string; amountCents: number; coversMonth?: string | null; note?: string };
export type ImportEmployee = { name: string; entries: ImportEntry[]; payments?: ImportPayment[] };
export type ImportFile = { employees: ImportEmployee[] };

export type Discrepancy = { employee: string; date: string; start: string; end: string; field: "minutes" | "charge"; computed: number; sheet: number };

/** A row with no date. It is listed for the admin to fix or skip, never dropped silently. */
export type NeedsDate = { employee: string; index: number; start: string; end: string; rate: string };
export type DateFix = { employee: string; index: number; date?: string; skip?: boolean };

export type Plan = {
  employees: { name: string; entries: EntryInput[]; payments: PaymentInput[] }[];
  errors: string[];
  discrepancies: Discrepancy[];
  needsDate: NeedsDate[];
};

/** Applies the admin's date fixes and skips. `index` is the row's position in that employee's entries. Returns the file and how many rows were skipped. */
export function applyDateFixes(file: ImportFile, fixes: DateFix[]): { file: ImportFile; skipped: number } {
  let skipped = 0;
  const employees = (file.employees ?? []).map((emp) => {
    const mine = fixes.filter((f) => f.employee === emp.name);
    const entries: ImportEntry[] = [];
    (emp.entries ?? []).forEach((r, i) => {
      const fix = mine.find((f) => f.index === i);
      if (fix?.skip) {
        skipped++;
        return;
      }
      entries.push(fix?.date ? { ...r, date: fix.date } : r);
    });
    return { ...emp, entries };
  });
  return { file: { ...file, employees }, skipped };
}

export function planImport(file: ImportFile): Plan {
  const plan: Plan = { employees: [], errors: [], discrepancies: [], needsDate: [] };
  for (const emp of file.employees ?? []) {
    const name = String(emp.name ?? "").trim();
    if (!name) {
      plan.errors.push("an employee has no name");
      continue;
    }
    const entries: EntryInput[] = [];
    for (const [i, r] of (emp.entries ?? []).entries()) {
      const startMin = parseTime(String(r.start));
      const endMin = parseTime(String(r.end));
      const rateCents = typeof r.rate === "number" ? Math.round(r.rate * 100) : parseRate(String(r.rate));
      const where = `${name} entry ${i + 1}`;
      if (!String(r.date ?? "").trim()) {
        plan.needsDate.push({ employee: name, index: i, start: String(r.start), end: String(r.end), rate: String(r.rate) });
        continue;
      }
      if (startMin === null || endMin === null || rateCents === null) {
        plan.errors.push(`${where}: unreadable time or rate`);
        continue;
      }
      const e: EntryInput = { date: String(r.date), startMin, endMin, rateCents };
      const bad = entryError(e);
      if (bad) {
        plan.errors.push(`${where}: ${bad}`);
        continue;
      }
      const m = minutesWorked(startMin, endMin);
      const base = { employee: name, date: e.date, start: String(r.start), end: String(r.end) };
      if (r.sheetMinutes !== undefined && Math.round(r.sheetMinutes) !== m) plan.discrepancies.push({ ...base, field: "minutes", computed: m, sheet: r.sheetMinutes });
      const c = chargeCents(m, rateCents);
      if (r.sheetChargeCents !== undefined && r.sheetChargeCents !== c) plan.discrepancies.push({ ...base, field: "charge", computed: c, sheet: r.sheetChargeCents });
      entries.push(e);
    }
    const payments: PaymentInput[] = [];
    for (const [i, p] of (emp.payments ?? []).entries()) {
      const pay: PaymentInput = { date: String(p.date), amountCents: p.amountCents, coversMonth: p.coversMonth ?? null, note: p.note ?? "" };
      const bad = paymentError(pay);
      if (bad || !isISODate(pay.date)) plan.errors.push(`${name} payment ${i + 1}: ${bad ?? "bad date"}`);
      else payments.push(pay);
    }
    plan.employees.push({ name, entries, payments });
  }
  return plan;
}

/** Identity of an entry for "already imported": same employee, date, start and end. */
export const entryKey = (employeeId: string, e: { date: string; startMin: number; endMin: number }) => `${employeeId}|${e.date}|${e.startMin}|${e.endMin}`;
/** Identity of a payment: same employee, date, amount and covered month. */
export const paymentKey = (employeeId: string, p: { date: string; amountCents: number; coversMonth: string | null }) => `${employeeId}|${p.date}|${p.amountCents}|${p.coversMonth ?? ""}`;
