// Dates are stored as "YYYY-MM-DD" strings so time zones never shift a day.

/** The practice's time zone (set PRACTICE_TIMEZONE; Washington State by default). */
export const PRACTICE_TIMEZONE = process.env.PRACTICE_TIMEZONE || "America/Los_Angeles";

/**
 * Today's date in the practice's time zone, not the server's or the browser's, so "today", "past due"
 * and recurring tasks mean the same thing for everybody. (A Cloud Run server runs in UTC, which would
 * otherwise roll the date over at 5 pm Pacific.)
 */
export function todayISO(now = new Date(), timeZone = PRACTICE_TIMEZONE): string {
  return new Intl.DateTimeFormat("en-CA", { timeZone, year: "numeric", month: "2-digit", day: "2-digit" }).format(now);
}

export function isISODate(value: string): boolean {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(value)) return false;
  const d = new Date(`${value}T00:00:00Z`);
  return !Number.isNaN(d.getTime()) && d.toISOString().slice(0, 10) === value;
}

export function addDays(iso: string, days: number): string {
  const d = new Date(`${iso}T00:00:00Z`);
  d.setUTCDate(d.getUTCDate() + days);
  return d.toISOString().slice(0, 10);
}

/** Monday of the week containing `iso`. */
export function startOfWeek(iso: string): string {
  const d = new Date(`${iso}T00:00:00Z`);
  const dow = (d.getUTCDay() + 6) % 7; // Monday = 0
  return addDays(iso, -dow);
}

export function formatLong(iso: string): string {
  return new Date(`${iso}T00:00:00Z`).toLocaleDateString("en-US", {
    weekday: "long",
    month: "short",
    day: "numeric",
    year: "numeric",
    timeZone: "UTC",
  });
}

export function diffDays(fromIso: string, toIso: string): number {
  const a = new Date(`${fromIso}T00:00:00Z`).getTime();
  const b = new Date(`${toIso}T00:00:00Z`).getTime();
  return Math.round((b - a) / 86400000);
}

/** Same display rules as the Todo App due-date pill. */
export function dueLabel(
  dueDate: string | null,
  today = todayISO(),
): { text: string; className: string } {
  if (!dueDate) return { text: "+ Due date", className: "" };
  const diff = diffDays(today, dueDate);
  if (diff === 0) return { text: "Today", className: "due-today" };
  if (diff === 1) return { text: "Tomorrow", className: "due-soon" };
  if (diff < 0) return { text: `Overdue ${Math.abs(diff)}d`, className: "due-overdue" };
  const text = new Date(`${dueDate}T00:00:00Z`).toLocaleDateString("en-US", {
    month: "short",
    day: "numeric",
    timeZone: "UTC",
  });
  return { text, className: "" };
}

/** Excel serial date (days since 1899-12-30) to ISO. */
export function excelSerialToISO(serial: number): string {
  const ms = Math.round(serial * 86400000);
  return new Date(Date.UTC(1899, 11, 30) + ms).toISOString().slice(0, 10);
}

export function startOfMonth(iso: string): string {
  return `${iso.slice(0, 7)}-01`;
}

/** First day of the month `n` months away from the month containing `iso`. */
export function addMonths(iso: string, n: number): string {
  const [y, m] = iso.split("-").map(Number);
  const d = new Date(Date.UTC(y, m - 1 + n, 1));
  return d.toISOString().slice(0, 10);
}

export function endOfMonth(iso: string): string {
  return addDays(addMonths(iso, 1), -1);
}

/** Weeks (Monday first) covering the month containing `iso`, as arrays of 7 ISO dates. */
export function monthWeeks(iso: string): string[][] {
  const first = startOfMonth(iso);
  const last = endOfMonth(iso);
  const weeks: string[][] = [];
  let cursor = startOfWeek(first);
  while (cursor <= last) {
    weeks.push(Array.from({ length: 7 }, (_, i) => addDays(cursor, i)));
    cursor = addDays(cursor, 7);
  }
  return weeks;
}

export function formatShort(iso: string): string {
  return new Date(`${iso}T00:00:00Z`).toLocaleDateString("en-US", {
    weekday: "short",
    month: "short",
    day: "numeric",
    timeZone: "UTC",
  });
}

export function formatMonth(iso: string): string {
  return new Date(`${iso}T00:00:00Z`).toLocaleDateString("en-US", {
    month: "long",
    year: "numeric",
    timeZone: "UTC",
  });
}
