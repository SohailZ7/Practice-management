// Dates are stored as "YYYY-MM-DD" strings so time zones never shift a day.

export function todayISO(now = new Date()): string {
  const y = now.getFullYear();
  const m = String(now.getMonth() + 1).padStart(2, "0");
  const d = String(now.getDate()).padStart(2, "0");
  return `${y}-${m}-${d}`;
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
