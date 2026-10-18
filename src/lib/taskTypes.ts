import type { Task, TaskLink } from "@prisma/client";

export type LinkDTO = { id: string; url: string; label: string; type: string };

export type TaskDTO = {
  id: string;
  title: string;
  categoryId: string | null;
  assigneeId: string | null;
  dueDate: string | null;
  completed: boolean;
  inToday: boolean;
  sortOrder: number;
  links: LinkDTO[];
};

export type TaskPatch = Partial<
  Pick<TaskDTO, "title" | "categoryId" | "assigneeId" | "dueDate" | "completed" | "inToday">
>;

export type CategoryDTO = { id: string; name: string };

export function toTaskDTO(t: Task & { links: TaskLink[] }): TaskDTO {
  return {
    id: t.id,
    title: t.title,
    categoryId: t.categoryId,
    assigneeId: t.assigneeId,
    dueDate: t.dueDate,
    completed: t.completed,
    inToday: t.inToday,
    sortOrder: t.sortOrder,
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
