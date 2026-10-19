import { db } from "./db";
import { addDays } from "./dates";
import { buildAnalytics, buildTeamAnalytics, lastNDays, type Analytics, type TeamAnalytics, type Window } from "./analytics";

export type TeamAnalyticsResult = {
  team: TeamAnalytics;
  /** The same completions grouped by category, for the by-category toggle. */
  byCategory: Analytics;
  categories: { id: string; name: string }[];
};

/**
 * Loads only what the viewer may see. `scopeIds` (employee ids) and `includeUnassigned` are decided on
 * the server from the signed-in user; they are the only filter on every query below.
 * Fetches completed tasks inside the window plus grouped open counts, never every task.
 */
export async function loadTeamAnalytics(o: {
  scopeIds: string[];
  includeUnassigned: boolean;
  periodDays: Window;
  now?: number;
}): Promise<TeamAnalyticsResult> {
  const now = o.now ?? Date.now();
  const days = lastNDays(o.periodDays, now);
  // A day boundary in the practice zone is within 24 h of UTC midnight of that date; the pure code does the exact cut.
  const since = new Date(new Date(`${addDays(days[0], -1)}T00:00:00Z`).getTime());
  const scope = {
    OR: [{ assigneeId: { in: o.scopeIds } }, ...(o.includeUnassigned ? [{ assigneeId: null }] : [])],
  };

  const [employees, categories, completed, openRows, undated] = await Promise.all([
    db.employee.findMany({ select: { id: true, name: true, active: true } }),
    db.category.findMany({ orderBy: [{ sortOrder: "asc" }, { name: "asc" }], select: { id: true, name: true } }),
    db.task.findMany({
      where: { ...scope, completed: true, completedAt: { gte: since } },
      select: { assigneeId: true, categoryId: true, completedAt: true },
    }),
    db.task.groupBy({
      by: ["assigneeId", "dueDate", "expiresAt"],
      where: { ...scope, completed: false },
      _count: { _all: true },
    }),
    db.task.count({ where: { ...scope, completed: true, completedAt: null } }),
  ]);

  const completions = completed.map((t) => ({
    assigneeId: t.assigneeId,
    categoryId: t.categoryId,
    completedAt: t.completedAt ? t.completedAt.getTime() : null,
  }));
  const allowed = new Set(o.scopeIds);
  const team = buildTeamAnalytics({
    people: employees.filter((e) => allowed.has(e.id)),
    colorKeys: employees.map((e) => e.id),
    completions,
    openRows: openRows.map((r) => ({ assigneeId: r.assigneeId, dueDate: r.dueDate, expiresAt: r.expiresAt, count: r._count._all })),
    undated,
    includeUnassigned: o.includeUnassigned,
    periodDays: o.periodDays,
    now,
  });
  const byCategory = buildAnalytics(
    completions.map((c) => ({ completed: true, completedAt: c.completedAt, categoryId: c.categoryId })),
    categories.map((c) => c.id),
    o.periodDays,
    now,
  );
  return { team, byCategory, categories };
}
