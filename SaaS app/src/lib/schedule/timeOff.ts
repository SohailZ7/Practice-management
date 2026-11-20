// Provider unavailable days. Dates are YYYY-MM-DD text, ranges inclusive. Pure helpers, no DB.
export const TIME_OFF_KINDS = [
  { value: "time_off", label: "Time off" },
  { value: "sick", label: "Sick" },
  { value: "conference", label: "Conference / training" },
  { value: "limitation", label: "Limitation" },
] as const;

export type TimeOffRange = { startDate: string; endDate: string; kind: string; note?: string };

const DATE_RE = /^\d{4}-\d{2}-\d{2}$/;

export function isIsoDate(s: string): boolean {
  if (!DATE_RE.test(s)) return false;
  const d = new Date(`${s}T00:00:00Z`);
  return !Number.isNaN(d.getTime()) && d.toISOString().slice(0, 10) === s;
}

/** Returns an error message, or null when the range is fine. */
export function validateTimeOff(startDate: string, endDate: string): string | null {
  if (!isIsoDate(startDate)) return "Enter a valid start date.";
  if (!isIsoDate(endDate)) return "Enter a valid end date.";
  if (endDate < startDate) return "The end date is before the start date.";
  return null;
}

export function timeOffOn(ranges: TimeOffRange[], date: string): TimeOffRange[] {
  return ranges.filter((r) => r.startDate <= date && date <= r.endDate);
}

export function kindLabel(kind: string): string {
  return TIME_OFF_KINDS.find((k) => k.value === kind)?.label ?? "Time off";
}

export function formatRange(r: { startDate: string; endDate: string }): string {
  return r.startDate === r.endDate ? r.startDate : `${r.startDate} to ${r.endDate}`;
}
