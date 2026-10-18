import type { Task, TaskLink } from "@prisma/client";

export type LinkDTO = { id: string; url: string; label: string; type: string };

export type TaskDTO = {
  id: string;
  title: string;
  categoryId: string | null;
  assigneeId: string | null;
  dueDate: string | null;
  /** YYYY-MM-DD after which an unfinished task no longer applies; null = no expiration. */
  expiresAt: string | null;
  completed: boolean;
  /** Epoch milliseconds when it was completed, or null (not done, or finished before dates were tracked). */
  completedAt: number | null;
  inToday: boolean;
  sortOrder: number;
  /** Created by a recurring task. */
  recurring: boolean;
  links: LinkDTO[];
};

export type TaskPatch = Partial<
  Pick<TaskDTO, "title" | "categoryId" | "assigneeId" | "dueDate" | "expiresAt" | "completed" | "inToday">
>;

export type CategoryDTO = { id: string; name: string };

export function toTaskDTO(t: Task & { links: TaskLink[] }): TaskDTO {
  return {
    id: t.id,
    title: t.title,
    categoryId: t.categoryId,
    assigneeId: t.assigneeId,
    dueDate: t.dueDate,
    expiresAt: t.expiresAt,
    completed: t.completed,
    completedAt: t.completedAt ? t.completedAt.getTime() : null,
    inToday: t.inToday,
    sortOrder: t.sortOrder,
    recurring: t.recurringId !== null,
    links: t.links.map((l) => ({ id: l.id, url: l.url, label: l.label, type: l.type })),
  };
}

/**
 * Re-orders `ids` within the full ordered list the way the Todo App does: the moved items keep
 * occupying the same slots in the list, just in the new order.
 */
export function applyReorder<T extends { id: string }>(all: T[], orderedIds: string[]): T[] {
  const inSet = new Set(orderedIds);
  const byId = new Map(all.map((t) => [t.id, t]));
  let cursor = 0;
  return all.map((t) => (inSet.has(t.id) ? (byId.get(orderedIds[cursor++]) ?? t) : t));
}

/** True when an unfinished task has passed its expiration date. */
export const isExpired = (t: { completed: boolean; expiresAt: string | null }, today: string) =>
  !t.completed && t.expiresAt !== null && t.expiresAt < today;

/**
 * Splits tasks into the board's sections.
 * - Expired: open, expiration date before today (out of the queue, kept visible and restorable).
 * - Past due: open, due date before today (most overdue first).
 * - Today: open, due today or flagged for Today.
 * - Backlog: every other open task.
 * - Completed: done tasks.
 */
export function splitTasks<
  T extends Pick<TaskDTO, "id" | "completed" | "dueDate" | "expiresAt" | "inToday" | "sortOrder">,
>(tasks: T[], today: string) {
  const expired = tasks.filter((t) => isExpired(t, today));
  const expiredIds = new Set(expired.map((t) => t.id));
  const open = tasks.filter((t) => !t.completed && !expiredIds.has(t.id));
  const pastDue = open
    .filter((t) => t.dueDate !== null && t.dueDate < today)
    .sort((a, b) => (a.dueDate! < b.dueDate! ? -1 : a.dueDate! > b.dueDate! ? 1 : a.sortOrder - b.sortOrder));
  const past = new Set(pastDue.map((t) => t.id));
  const rest = open.filter((t) => !past.has(t.id));
  const todayList = rest.filter((t) => t.inToday || t.dueDate === today);
  const inToday = new Set(todayList.map((t) => t.id));
  return {
    expired,
    pastDue,
    today: todayList,
    backlog: rest.filter((t) => !inToday.has(t.id)),
    completed: tasks.filter((t) => t.completed),
  };
}

export type RecurringDTO = {
  id: string;
  title: string;
  assigneeId: string | null;
  frequency: string;
  weekday: number | null;
  dayOfMonth: number | null;
  startDate: string;
  endDate: string | null;
  active: boolean;
};

export type RecurringInput = Omit<RecurringDTO, "id" | "active">;
export type RecurringPatch = Partial<Omit<RecurringDTO, "id">>;
