// Completion analytics for the Tasks module (same idea as the Todo App's Analytics tab):
// tasks completed per day for the last N days, split by category.

export const NO_CATEGORY = "__none__";

type T = { completed: boolean; completedAt: number | null; categoryId: string | null };

/** YYYY-MM-DD in the local time zone. */
export function localDateKey(ts: number): string {
  const d = new Date(ts);
  const y = d.getFullYear();
  const m = String(d.getMonth() + 1).padStart(2, "0");
  const day = String(d.getDate()).padStart(2, "0");
  return `${y}-${m}-${day}`;
}

/** The last `n` local days ending today, oldest first. */
export function lastNDays(n: number, now = Date.now()): string[] {
  const today = new Date(now);
  const out: string[] = [];
  for (let i = n - 1; i >= 0; i--) {
    const d = new Date(today.getFullYear(), today.getMonth(), today.getDate() - i, 12);
    out.push(localDateKey(d.getTime()));
  }
  return out;
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

export function buildAnalytics(tasks: T[], categoryIds: string[], periodDays = 30, now = Date.now()): Analytics {
  const days = lastNDays(periodDays, now);
  const inWindow = new Set(days);
  const counts: Record<string, Record<string, number>> = Object.fromEntries(days.map((d) => [d, {}]));

  let total = 0;
  const perTrack = new Map<string, number>();
  for (const t of tasks) {
    if (!t.completed || t.completedAt == null) continue;
    const day = localDateKey(t.completedAt);
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
