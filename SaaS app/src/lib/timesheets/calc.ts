// Pure timesheet rules: time parsing and formatting, minutes, charge, month grouping, access. No database.
import { isISODate } from "../dates";

/**
 * Timesheets are Admin-only for now. A later release can let an employee see only their own sheet by flipping this on and
 * linking each TimesheetEmployee to a User (userId). Nothing else changes: every read and write goes through timesheetAccess.
 */
export const EMPLOYEES_SEE_OWN = false;

export type TimesheetAccess = "none" | "own" | "all";

export function timesheetAccess(
  user: { id: string; role: string; active: boolean },
  employee?: { userId: string | null },
): TimesheetAccess {
  if (!user.active) return "none";
  if (user.role === "ADMIN") return "all";
  if (EMPLOYEES_SEE_OWN && employee && employee.userId === user.id) return "own";
  return "none";
}

/** "5:27 PM", "5:27pm", "17:27" or "5 PM" to minutes after midnight, or null. */
export function parseTime(raw: string): number | null {
  const m = /^\s*(\d{1,2})(?::(\d{2}))?\s*([ap]\.?m?\.?)?\s*$/i.exec(raw);
  if (!m) return null;
  let h = Number(m[1]);
  const min = m[2] === undefined ? 0 : Number(m[2]);
  if (min > 59) return null;
  const ampm = m[3]?.[0]?.toLowerCase();
  if (ampm) {
    if (h < 1 || h > 12) return null;
    h = (h % 12) + (ampm === "p" ? 12 : 0);
  } else if (h > 23) {
    return null;
  }
  return h * 60 + min;
}

/** Minutes after midnight to "5:27 PM". */
export function formatTime(mins: number): string {
  const h24 = Math.floor(mins / 60) % 24;
  const m = mins % 60;
  const h = h24 % 12 === 0 ? 12 : h24 % 12;
  return `${h}:${String(m).padStart(2, "0")} ${h24 >= 12 ? "PM" : "AM"}`;
}

/** Minutes after midnight to "17:27" for a time input. */
export function timeInputValue(mins: number): string {
  return `${String(Math.floor(mins / 60)).padStart(2, "0")}:${String(mins % 60).padStart(2, "0")}`;
}

export const minutesWorked = (startMin: number, endMin: number): number => endMin - startMin;

/** Charge in cents: minutes / 60 x hourly rate, rounded to the nearest cent. 39 min at $23.00 = $14.95. */
export function chargeCents(minutes: number, rateCents: number): number {
  return Math.round((minutes * rateCents) / 60);
}

export function formatMoney(cents: number): string {
  const sign = cents < 0 ? "-" : "";
  const abs = Math.abs(cents);
  return `${sign}$${Math.floor(abs / 100).toLocaleString("en-US")}.${String(abs % 100).padStart(2, "0")}`;
}

/** "$23", "23.5" or "$23.00" to cents, or null. */
export function parseRate(raw: string): number | null {
  const m = /^\s*\$?\s*(\d{1,4})(?:\.(\d{1,2}))?\s*$/.exec(raw);
  if (!m) return null;
  return Number(m[1]) * 100 + (m[2] ? Number(m[2].padEnd(2, "0")) : 0);
}

export const MAX_RATE_CENTS = 100000; // $1,000 an hour is far past any real rate; stops a typo

export type EntryInput = { date: string; startMin: number; endMin: number; rateCents: number };

export function entryError(e: EntryInput): string | null {
  if (!isISODate(e.date)) return "Enter a valid date.";
  if (!Number.isInteger(e.startMin) || !Number.isInteger(e.endMin) || e.startMin < 0 || e.endMin > 24 * 60 || e.startMin > 24 * 60) {
    return "Enter a valid start and end time.";
  }
  if (e.endMin <= e.startMin) return "End time must be after start time (an entry cannot cross midnight; split it in two).";
  if (!Number.isInteger(e.rateCents) || e.rateCents < 0 || e.rateCents > MAX_RATE_CENTS) return "Enter a valid hourly rate.";
  return null;
}

export type SheetEntry = { id: string; date: string; startMin: number; endMin: number; rateCents: number };

export const monthKey = (date: string): string => date.slice(0, 7);

/** Entries in date then start order. Several entries may share a date. */
export function sortEntries<T extends SheetEntry>(rows: T[]): T[] {
  return [...rows].sort((a, b) => a.date.localeCompare(b.date) || a.startMin - b.startMin || a.id.localeCompare(b.id));
}

export function totals(rows: SheetEntry[]): { entries: number; minutes: number; chargeCents: number } {
  let minutes = 0;
  let charge = 0;
  for (const r of rows) {
    const m = minutesWorked(r.startMin, r.endMin);
    minutes += m;
    charge += chargeCents(m, r.rateCents);
  }
  return { entries: rows.length, minutes, chargeCents: charge };
}

export function formatDuration(minutes: number): string {
  return `${Math.floor(minutes / 60)}h ${String(minutes % 60).padStart(2, "0")}m`;
}

/** Month keys (YYYY-MM) newest first, always including the current month so a new month has a tab before its first entry. */
export function monthTabs(dates: string[], currentMonth: string): string[] {
  return Array.from(new Set([...dates.map(monthKey), currentMonth])).sort().reverse();
}

export const isMonthKey = (v: string): boolean => /^\d{4}-(0[1-9]|1[0-2])$/.test(v);

export function monthLabel(key: string): string {
  return new Date(`${key}-01T00:00:00Z`).toLocaleDateString("en-US", { month: "long", year: "numeric", timeZone: "UTC" });
}

/** The reference sheet shows dates as 10/01/26. */
export function sheetDate(iso: string): string {
  return `${iso.slice(5, 7)}/${iso.slice(8, 10)}/${iso.slice(2, 4)}`;
}

/** CSV with the same columns as the reference sheet, then a total row. Dates are ISO-free sheet dates, so nothing needs quoting. */
export function toCsv(rows: SheetEntry[]): string {
  const lines = ["Date,Start Time,End Time,Minutes Worked,Rate / Hr,Charge"];
  for (const r of sortEntries(rows)) {
    const m = minutesWorked(r.startMin, r.endMin);
    lines.push(
      [sheetDate(r.date), formatTime(r.startMin), formatTime(r.endMin), String(m), formatMoney(r.rateCents), formatMoney(chargeCents(m, r.rateCents))]
        .map((f) => (/[",\n\r]/.test(f) ? `"${f.replace(/"/g, '""')}"` : f))
        .join(","),
    );
  }
  const t = totals(rows);
  lines.push(["Total", "", "", String(t.minutes), "", formatMoney(t.chargeCents)].join(","));
  return lines.join("\r\n") + "\r\n";
}

export const EMPLOYEE_NAMES = ["Muntaha", "Janita", "Zaid"] as const;
export const DEFAULT_RATE_CENTS = 2300;

// ---- Payments and balances ----

export type PaymentInput = { date: string; amountCents: number; coversMonth: string | null; note: string };

export const MAX_PAYMENT_CENTS = 100_000_000; // $1,000,000

export function paymentError(p: PaymentInput): string | null {
  if (!isISODate(p.date)) return "Enter the date paid.";
  if (!Number.isInteger(p.amountCents) || p.amountCents <= 0 || p.amountCents > MAX_PAYMENT_CENTS) return "Enter the amount paid, more than $0.";
  if (p.coversMonth !== null && !isMonthKey(p.coversMonth)) return "Choose a month the payment covers, or leave it blank.";
  if (p.note.length > 300) return "Keep the note to 300 characters or fewer.";
  return null;
}

export type PaidRow = { amountCents: number; coversMonth: string | null };

/** Charged minus paid. A payment counts toward a month only when it says which month it covers; every payment counts toward the employee. */
export function balances(charged: SheetEntry[], payments: PaidRow[], month: string) {
  const all = totals(charged);
  const inMonth = totals(charged.filter((r) => monthKey(r.date) === month));
  const paidAll = payments.reduce((s, p) => s + p.amountCents, 0);
  const paidMonth = payments.filter((p) => p.coversMonth === month).reduce((s, p) => s + p.amountCents, 0);
  return {
    month: { chargedCents: inMonth.chargeCents, paidCents: paidMonth, balanceCents: inMonth.chargeCents - paidMonth },
    employee: { chargedCents: all.chargeCents, paidCents: paidAll, balanceCents: all.chargeCents - paidAll },
  };
}

/** Text of the matching Ledger row. Names the employee and month; never pay details beyond the amount in the row itself. */
export function ledgerComment(employeeName: string, coversMonth: string | null, note: string): string {
  const parts = [`Timesheet payment: ${employeeName}`];
  if (coversMonth) parts.push(`for ${monthLabel(coversMonth)}`);
  const base = parts.join(" ");
  return (note ? `${base}. ${note}` : base).slice(0, 1000);
}
