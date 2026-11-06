// Calendar dates are plain "YYYY-MM-DD" strings in the practice's own time zone (Pacific). Never build them with
// toISOString() on a local Date: after 5 pm Pacific that is already tomorrow in UTC.
export const PRACTICE_TZ = "America/Los_Angeles";

export const practiceToday = (now: Date = new Date()): string =>
  new Intl.DateTimeFormat("en-CA", { timeZone: PRACTICE_TZ }).format(now);

/** Moves a plain date by whole days. Done in UTC on a date-only value, so the machine's zone and DST never matter. */
export const shiftDate = (iso: string, days: number): string => {
  const d = new Date(`${iso}T00:00:00Z`);
  d.setUTCDate(d.getUTCDate() + days);
  return d.toISOString().slice(0, 10);
};

export const longDate = (iso: string): string =>
  new Date(`${iso}T00:00:00Z`).toLocaleDateString("en-US", { weekday: "long", month: "long", day: "numeric", year: "numeric", timeZone: "UTC" });
