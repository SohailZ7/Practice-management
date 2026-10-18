// Recurrence rules for repeating tasks. Pure functions over YYYY-MM-DD strings.
import { addDays } from "./dates";

export const FREQUENCIES = ["DAILY", "WEEKLY", "MONTHLY"] as const;
export type Frequency = (typeof FREQUENCIES)[number];

export type Rule = {
  frequency: string;
  /** 0 = Monday .. 6 = Sunday (weekly). */
  weekday: number | null;
  /** 1..31 (monthly); months that are too short use their last day. */
  dayOfMonth: number | null;
  startDate: string;
  endDate: string | null;
};

export const WEEKDAYS = ["Monday", "Tuesday", "Wednesday", "Thursday", "Friday", "Saturday", "Sunday"];

export function isFrequency(v: unknown): v is Frequency {
  return typeof v === "string" && (FREQUENCIES as readonly string[]).includes(v);
}

const dow = (iso: string) => (new Date(`${iso}T00:00:00Z`).getUTCDay() + 6) % 7;

function monthDay(year: number, month1: number, day: number): string {
  const last = new Date(Date.UTC(year, month1, 0)).getUTCDate();
  return `${year}-${String(month1).padStart(2, "0")}-${String(Math.min(day, last)).padStart(2, "0")}`;
}

/** Returns an error message for an invalid rule, or null. */
export function ruleError(r: Rule): string | null {
  if (!isFrequency(r.frequency)) return "Choose daily, weekly or monthly.";
  if (r.frequency === "WEEKLY" && !(Number.isInteger(r.weekday) && r.weekday! >= 0 && r.weekday! <= 6)) {
    return "Choose a day of the week.";
  }
  if (r.frequency === "MONTHLY" && !(Number.isInteger(r.dayOfMonth) && r.dayOfMonth! >= 1 && r.dayOfMonth! <= 31)) {
    return "Choose a day of the month (1 to 31).";
  }
  if (r.endDate && r.endDate < r.startDate) return "The end date can't be before the start date.";
  return null;
}

/** The most recent occurrence on or before `today` (and within the start/end dates), or null. */
export function latestOccurrence(r: Rule, today: string): string | null {
  const eff = r.endDate && r.endDate < today ? r.endDate : today;
  if (eff < r.startDate) return null;
  let cand: string;
  if (r.frequency === "DAILY") {
    cand = eff;
  } else if (r.frequency === "WEEKLY") {
    cand = addDays(eff, -((dow(eff) - (r.weekday ?? 0) + 7) % 7));
  } else {
    const [y, m] = eff.split("-").map(Number);
    cand = monthDay(y, m, r.dayOfMonth ?? 1);
    if (cand > eff) {
      const prev = new Date(Date.UTC(y, m - 2, 1));
      cand = monthDay(prev.getUTCFullYear(), prev.getUTCMonth() + 1, r.dayOfMonth ?? 1);
    }
  }
  return cand < r.startDate ? null : cand;
}

/** The first occurrence strictly after `date` (and within the end date), or null. */
export function nextOccurrenceAfter(r: Rule, date: string): string | null {
  const from = date < r.startDate ? addDays(r.startDate, -1) : date;
  let cand: string;
  if (r.frequency === "DAILY") {
    cand = addDays(from, 1);
  } else if (r.frequency === "WEEKLY") {
    cand = addDays(from, ((r.weekday ?? 0) - dow(from) + 7) % 7 || 7);
  } else {
    const [y, m, d] = from.split("-").map(Number);
    cand = monthDay(y, m, r.dayOfMonth ?? 1);
    if (cand <= from) {
      const nxt = new Date(Date.UTC(y, m, 1));
      cand = monthDay(nxt.getUTCFullYear(), nxt.getUTCMonth() + 1, r.dayOfMonth ?? 1);
    }
    void d;
  }
  return r.endDate && cand > r.endDate ? null : cand;
}

const ordinal = (n: number) => {
  const s = ["th", "st", "nd", "rd"];
  const v = n % 100;
  return `${n}${s[(v - 20) % 10] || s[v] || s[0]}`;
};

export function describeRule(r: Pick<Rule, "frequency" | "weekday" | "dayOfMonth">): string {
  if (r.frequency === "DAILY") return "Every day";
  if (r.frequency === "WEEKLY") return `Every ${WEEKDAYS[r.weekday ?? 0]}`;
  return `Monthly on the ${ordinal(r.dayOfMonth ?? 1)}`;
}
