// Appointment times on the schedule: a single time ("2:00 PM") or a range ("9:00 AM-12:00 PM"). Pure and tested.
// Order rule (change request): a visit sorts by the time it must be seen BY, so exact times and short ranges come before
// longer ones that run later. Their example: 10 AM, 9-11, 9-12, 1 PM, 12-3. Ties put the exact time first, then the earlier start.

export type TimeSpan = { start: number; end: number; exact: boolean };

/** Minutes after midnight for "2:00 PM", "14:00", "2 PM" or "2:00" (no AM/PM: 1 to 6 count as afternoon). Null if not a time. */
export function minutesOf(raw: string): number | null {
  const m = /^(\d{1,2})(?::(\d{2}))?\s*([ap])?\.?m?\.?$/i.exec(raw.trim());
  if (!m) return null;
  let h = Number(m[1]);
  const min = Number(m[2] ?? 0);
  if (min > 59) return null;
  const ap = m[3]?.toLowerCase();
  if (ap) {
    if (h < 1 || h > 12) return null;
    h = (h % 12) + (ap === "p" ? 12 : 0);
  } else {
    if (h > 23) return null;
    if (h >= 1 && h <= 6) h += 12;
  }
  return h * 60 + min;
}

export function parseSpan(text: string): TimeSpan | null {
  const parts = (text ?? "").split(/\s*-\s*/).filter((p) => p.trim());
  if (parts.length === 0 || parts.length > 2) return null;
  const a = minutesOf(parts[0]);
  if (a === null) return null;
  if (parts.length === 1) return { start: a, end: a, exact: true };
  let b = minutesOf(parts[1]);
  if (b === null) return null;
  if (b < a && b < 12 * 60) b += 12 * 60; // "9:00 AM-12" style slips
  return { start: a, end: Math.max(a, b), exact: false };
}

/** Sort key: rows without a usable time go last, in their original order. */
export function sortRows<T extends { apptTime: string }>(rows: T[]): T[] {
  const keyed = rows.map((r, i) => ({ r, i, s: parseSpan(r.apptTime) }));
  keyed.sort((x, y) => {
    if (!x.s || !y.s) return x.s ? -1 : y.s ? 1 : x.i - y.i;
    return x.s.end - y.s.end || Number(y.s.exact) - Number(x.s.exact) || x.s.start - y.s.start || x.i - y.i;
  });
  return keyed.map((k) => k.r);
}

const pad = (n: number) => String(n).padStart(2, "0");
export function formatMinutes(min: number, military: boolean): string {
  const h = Math.floor(min / 60) % 24;
  const m = min % 60;
  if (military) return `${pad(h)}${pad(m)}`;
  return `${h % 12 || 12}:${pad(m)} ${h >= 12 ? "PM" : "AM"}`;
}

/** The stored text shown as 12-hour ("2:00 PM") or military ("1400-1500"). Text that is not a time is returned unchanged. */
export function formatTimeText(text: string, military: boolean): string {
  const parts = (text ?? "").split(/\s*-\s*/).filter((p) => p.trim());
  if (parts.length === 0 || parts.length > 2) return text ?? "";
  const mins = parts.map(minutesOf);
  if (mins.some((m) => m === null)) return text;
  return mins.map((m) => formatMinutes(m as number, military)).join("-");
}

/** Pre-made ranges offered when entering a time. One list: edit here to change what the pick list shows. */
export const TIME_PRESETS = [
  "8:30 AM-11:00 AM", "9:00 AM-12:00 PM", "9:30 AM-12:00 PM", "12:00 PM-3:00 PM", "1:00 PM-4:00 PM", "9:00 AM-3:00 PM",
] as const;

/** Typed military times ("0900", "0900-1200", "1430") become 12-hour text the rest of the app stores; anything else passes through. */
export function normalizeTyped(text: string): string {
  const parts = (text ?? "").split(/\s*-\s*/);
  if (parts.length === 0 || parts.length > 2) return text;
  if (!parts.every((p) => /^\d{4}$/.test(p.trim()))) return text;
  const out: string[] = [];
  for (const p of parts) {
    const h = Number(p.trim().slice(0, 2));
    const m = Number(p.trim().slice(2));
    if (h > 23 || m > 59) return text;
    out.push(formatMinutes(h * 60 + m, false));
  }
  return out.join("-");
}
