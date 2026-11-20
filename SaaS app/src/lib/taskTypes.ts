import type { Task, TaskLink } from "@prisma/client";

/** Task states. `completed` stays the source of truth for Done; the stored `status` only separates not_started from in_progress. */
export const TASK_STATUSES = ["not_started", "in_progress", "done"] as const;
export type TaskStatus = (typeof TASK_STATUSES)[number];
export const TASK_STATUS_LABEL: Record<TaskStatus, string> = { not_started: "Not started", in_progress: "In progress", done: "Done" };
export const isTaskStatus = (v: unknown): v is TaskStatus => typeof v === "string" && (TASK_STATUSES as readonly string[]).includes(v);

/** The state of a stored task. Old rows (done flag only, status defaulted) map: done -> Done, open -> Not started. */
export const taskStatus = (t: { completed: boolean; status?: string | null }): TaskStatus =>
  t.completed ? "done" : t.status === "in_progress" ? "in_progress" : "not_started";

/** The columns to write when moving to `to`. completedAt is set only on the way into Done and cleared on the way out. */
export function taskStatusFields(
  to: TaskStatus,
  existing: { completed: boolean; completedAt: Date | null },
  now: Date = new Date(),
): { status: TaskStatus; completed: boolean; completedAt: Date | null } {
  if (to === "done") return { status: "done", completed: true, completedAt: existing.completed ? existing.completedAt : now };
  return { status: to, completed: false, completedAt: null };
}

export type LinkDTO = { id: string; url: string; label: string; type: string };

export type TaskDTO = {
  id: string;
  title: string;
  /** Free-text notes shown in the notes popup. */
  notes: string;
  categoryId: string | null;
  assigneeId: string | null;
  dueDate: string | null;
  /** YYYY-MM-DD after which an unfinished task no longer applies; null = no expiration. */
  expiresAt: string | null;
  completed: boolean;
  status: TaskStatus;
  priority: TaskPriority;
  /** Epoch milliseconds when it was completed, or null (not done, or finished before dates were tracked). */
  completedAt: number | null;
  inToday: boolean;
  sortOrder: number;
  /** Created by a recurring task. */
  recurring: boolean;
  links: LinkDTO[];
  /** Dated updates (newest last). Optional so older callers keep working. */
  updates?: TaskUpdateDTO[];
};

export type TaskPatch = Partial<
  Pick<TaskDTO, "title" | "notes" | "categoryId" | "assigneeId" | "dueDate" | "expiresAt" | "completed" | "status" | "priority" | "inToday">
>;

export const TASK_PRIORITIES = ["high", "normal", "low"] as const;
export type TaskPriority = (typeof TASK_PRIORITIES)[number];
export const TASK_PRIORITY_LABEL: Record<TaskPriority, string> = { high: "High", normal: "Normal", low: "Low" };
export const isTaskPriority = (v: unknown): v is TaskPriority => typeof v === "string" && (TASK_PRIORITIES as readonly string[]).includes(v);
export const taskPriority = (v: unknown): TaskPriority => (isTaskPriority(v) ? v : "normal");
const PRIO_RANK: Record<TaskPriority, number> = { high: 0, normal: 1, low: 2 };

/** Auto sort: high before normal before low, then earliest due date (no date last), then the saved manual order. */
export function autoCompare(a: { priority: TaskPriority; dueDate: string | null; sortOrder: number }, b: { priority: TaskPriority; dueDate: string | null; sortOrder: number }): number {
  return PRIO_RANK[a.priority] - PRIO_RANK[b.priority] || (a.dueDate ?? "9999") .localeCompare(b.dueDate ?? "9999") || a.sortOrder - b.sortOrder;
}

export type TaskUpdateDTO = { id: string; author: string; body: string; at: number; seen: boolean };
export const MAX_UPDATE = 2000;

export const MAX_NOTES = 20000;

export type CategoryDTO = { id: string; name: string };

export function toTaskDTO(t: Task & { links: TaskLink[]; updates?: { id: string; authorName: string; body: string; createdAt: Date; seenAt: Date | null }[] }): TaskDTO {
  return {
    id: t.id,
    title: t.title,
    notes: t.notes,
    categoryId: t.categoryId,
    assigneeId: t.assigneeId,
    dueDate: t.dueDate,
    expiresAt: t.expiresAt,
    completed: t.completed,
    status: taskStatus(t),
    priority: taskPriority(t.priority),
    completedAt: t.completedAt ? t.completedAt.getTime() : null,
    inToday: t.inToday,
    sortOrder: t.sortOrder,
    recurring: t.recurringId !== null,
    links: t.links.map((l) => ({ id: l.id, url: l.url, label: l.label, type: l.type })),
    updates: (t.updates ?? []).map((u) => ({ id: u.id, author: u.authorName, body: u.body, at: u.createdAt.getTime(), seen: u.seenAt !== null })),
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
 * - Past due: open, due date before today, in the manual (drag) order, then most overdue first.
 * - Today: open, due today or flagged for Today.
 * - Backlog: every other open task.
 * - Completed: done tasks.
 */
export function splitTasks<
  T extends Pick<TaskDTO, "id" | "completed" | "dueDate" | "expiresAt" | "inToday" | "sortOrder"> & { priority?: TaskPriority },
>(tasks: T[], today: string, auto = false) {
  const expired = tasks.filter((t) => isExpired(t, today));
  const expiredIds = new Set(expired.map((t) => t.id));
  const open = tasks.filter((t) => !t.completed && !expiredIds.has(t.id));
  const pastDue = open
    .filter((t) => t.dueDate !== null && t.dueDate < today)
    .sort((a, b) => a.sortOrder - b.sortOrder || (a.dueDate! < b.dueDate! ? -1 : a.dueDate! > b.dueDate! ? 1 : 0));
  const past = new Set(pastDue.map((t) => t.id));
  const rest = open.filter((t) => !past.has(t.id));
  const todayList = rest.filter((t) => t.inToday || t.dueDate === today);
  const inToday = new Set(todayList.map((t) => t.id));
  const order = (l: T[]) => (auto ? [...l].sort((a, b) => autoCompare({ ...a, priority: taskPriority(a.priority) }, { ...b, priority: taskPriority(b.priority) })) : l);
  return {
    expired,
    pastDue: order(pastDue),
    today: order(todayList),
    backlog: order(rest.filter((t) => !inToday.has(t.id))),
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
