// Completion analytics for the Tasks module (same idea as the Todo App's Analytics tab):
// tasks completed per day for the last N days, split by category (one board) or by employee (the team view).
// Days are practice-time-zone days (see dates.ts), so a 11 pm Pacific completion lands on that Pacific day.

import { PRACTICE_TIMEZONE, addDays, todayISO } from "./dates";
import { isExpired } from "./taskTypes";

export const NO_CATEGORY = "__none__";

type T = { completed: boolean; completedAt: number | null; categoryId: string | null };

/** YYYY-MM-DD of an instant in the practice's time zone (not the server's or the browser's). */
export function localDateKey(ts: number, timeZone = PRACTICE_TIMEZONE): string {
  return todayISO(new Date(ts), timeZone);
}

/** The last `n` practice-time-zone days ending today (inclusive), oldest first. */
export function lastNDays(n: number, now = Date.now(), timeZone = PRACTICE_TIMEZONE): string[] {
  const today = localDateKey(now, timeZone);
  return Array.from({ length: n }, (_, i) => addDays(today, i - (n - 1)));
}

export type Analytics = {
  days: string[];
  /** Categories that have at least one completion in the window, in the order given. */
  tracks: string[];
  /** counts[day][track] */
  counts: Record<string, Record<string, number>>;
  dayTotals: number[];
  maxDayTotal: number;
  totalCompleted: number;
  avgPerDay: number;
  byTrack: { id: string; total: number; avgPerDay: number }[];
};

export function buildAnalytics(tasks: T[], categoryIds: string[], periodDays = 30, now = Date.now(), timeZone = PRACTICE_TIMEZONE): Analytics {
  const days = lastNDays(periodDays, now, timeZone);
  const inWindow = new Set(days);
  const counts: Record<string, Record<string, number>> = Object.fromEntries(days.map((d) => [d, {}]));

  let total = 0;
  const perTrack = new Map<string, number>();
  for (const t of tasks) {
    if (!t.completed || t.completedAt == null) continue;
    const day = localDateKey(t.completedAt, timeZone);
    if (!inWindow.has(day)) continue;
    const track = t.categoryId ?? NO_CATEGORY;
    counts[day][track] = (counts[day][track] ?? 0) + 1;
    perTrack.set(track, (perTrack.get(track) ?? 0) + 1);
    total++;
  }

  const order = [...categoryIds, NO_CATEGORY];
  const tracks = order.filter((id) => perTrack.has(id));
  const dayTotals = days.map((d) => Object.values(counts[d]).reduce((a, b) => a + b, 0));
  return {
    days,
    tracks,
    counts,
    dayTotals,
    maxDayTotal: Math.max(1, ...dayTotals),
    totalCompleted: total,
    avgPerDay: total / periodDays,
    byTrack: tracks.map((id) => ({ id, total: perTrack.get(id)!, avgPerDay: perTrack.get(id)! / periodDays })),
  };
}

// ---- Team view: velocity per employee -------------------------------------------------------------

/** Id used for the "Unassigned" bucket (Admin only). */
export const UNASSIGNED_ID = "none";
export const WINDOWS = [7, 30, 90] as const;
export type Window = (typeof WINDOWS)[number];

/** Palette shared by every chart; colours are per employee, so the same person looks the same everywhere. */
export const PALETTE = ["#5b8def", "#d97706", "#16a34a", "#dc2626", "#7c3aed", "#0891b2", "#be185d", "#4b5563"];
export const UNASSIGNED_COLOR = "#8a8f98";

/** Window length from a query-string value; anything unexpected is 30 days. */
export function parseWindow(v: string | undefined): Window {
  const n = Number(v);
  return (WINDOWS as readonly number[]).includes(n) ? (n as Window) : 30;
}

/**
 * Stable colour for an employee: their rank among ALL employee ids (not just the visible ones), so it
 * does not change between viewers or views. With more employees than colours the palette wraps.
 */
export function employeeColor(id: string, allIds: string[]): string {
  if (id === UNASSIGNED_ID) return UNASSIGNED_COLOR;
  const rank = [...allIds].sort().indexOf(id);
  return PALETTE[(rank < 0 ? 0 : rank) % PALETTE.length];
}

export type TeamPerson = { id: string; name: string; active: boolean };
export type TeamCompletion = { assigneeId: string | null; categoryId: string | null; completedAt: number | null };
/** Open tasks grouped the way the server queries them (groupBy assignee, due date, expiry). */
export type TeamOpenRow = { assigneeId: string | null; dueDate: string | null; expiresAt: string | null; count: number };

export type TeamInput = {
  /** Employees the viewer may see (already restricted on the server). */
  people: TeamPerson[];
  /** Every employee id, for stable colours. */
  colorKeys: string[];
  /** Completed tasks near the window (the function does the exact day filtering). */
  completions: TeamCompletion[];
  /** Not-completed tasks, grouped. Expired ones are excluded here. */
  openRows: TeamOpenRow[];
  /** Completed tasks with no completion date that were not part of `completions`. */
  undated?: number;
  includeUnassigned: boolean;
  periodDays: number;
  now?: number;
  timeZone?: string;
};

export type TeamPersonStat = {
  id: string;
  name: string;
  active: boolean;
  color: string;
  completed: number;
  avgPerDay: number;
  open: number;
  pastDue: number;
};

export type TeamAnalytics = {
  periodDays: number;
  days: string[];
  people: TeamPersonStat[];
  /** counts[day][personId] */
  counts: Record<string, Record<string, number>>;
  dayTotals: number[];
  maxDayTotal: number;
  totalCompleted: number;
  avgPerDay: number;
  totalOpen: number;
  totalPastDue: number;
  /** Completed tasks without a date (finished before dates were tracked): not part of velocity. */
  undated: number;
};

export function buildTeamAnalytics(input: TeamInput): TeamAnalytics {
  const { periodDays, now = Date.now(), timeZone = PRACTICE_TIMEZONE } = input;
  const days = lastNDays(periodDays, now, timeZone);
  const inWindow = new Set(days);
  const today = localDateKey(now, timeZone);
  const key = (id: string | null) => id ?? UNASSIGNED_ID;
  // Anyone not in `people` (e.g. an employee the viewer may not see) is ignored, never counted.
  const known = new Set(input.people.map((p) => p.id));
  if (input.includeUnassigned) known.add(UNASSIGNED_ID);

  const counts: Record<string, Record<string, number>> = Object.fromEntries(days.map((d) => [d, {}]));
  const done = new Map<string, number>();
  let undated = input.undated ?? 0;
  for (const c of input.completions) {
    if (c.completedAt == null) { undated++; continue; }
    const day = localDateKey(c.completedAt, timeZone);
    const id = key(c.assigneeId);
    if (!inWindow.has(day) || !known.has(id)) continue;
    counts[day][id] = (counts[day][id] ?? 0) + 1;
    done.set(id, (done.get(id) ?? 0) + 1);
  }

  const open = new Map<string, number>();
  const pastDue = new Map<string, number>();
  for (const r of input.openRows) {
    const id = key(r.assigneeId);
    if (!known.has(id) || isExpired({ completed: false, expiresAt: r.expiresAt }, today)) continue;
    open.set(id, (open.get(id) ?? 0) + r.count);
    if (r.dueDate !== null && r.dueDate < today) pastDue.set(id, (pastDue.get(id) ?? 0) + r.count);
  }

  const stat = (p: TeamPerson): TeamPersonStat => ({
    id: p.id,
    name: p.name,
    active: p.active,
    color: employeeColor(p.id, input.colorKeys),
    completed: done.get(p.id) ?? 0,
    avgPerDay: (done.get(p.id) ?? 0) / periodDays,
    open: open.get(p.id) ?? 0,
    pastDue: pastDue.get(p.id) ?? 0,
  });
  // Active employees always appear (zeros included); deactivated ones only while they have completions in the window.
  const people = input.people
    .filter((p) => p.active || (done.get(p.id) ?? 0) > 0)
    .map(stat)
    .sort((a, b) => a.name.localeCompare(b.name));
  if (input.includeUnassigned) {
    const u = stat({ id: UNASSIGNED_ID, name: "Unassigned", active: true });
    if (u.completed > 0 || u.open > 0) people.push(u);
  }

  const dayTotals = days.map((d) => Object.values(counts[d]).reduce((a, b) => a + b, 0));
  const totalCompleted = people.reduce((s, p) => s + p.completed, 0);
  return {
    periodDays,
    days,
    people,
    counts,
    dayTotals,
    maxDayTotal: Math.max(1, ...dayTotals),
    totalCompleted,
    avgPerDay: totalCompleted / periodDays,
    totalOpen: people.reduce((s, p) => s + p.open, 0),
    totalPastDue: people.reduce((s, p) => s + p.pastDue, 0),
    undated,
  };
}
