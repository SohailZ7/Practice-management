"use server";

import { revalidatePath } from "next/cache";
import { db } from "@/lib/db";
import { audit } from "@/lib/audit";
import { requireAccess, type CurrentUser } from "@/lib/session";
import { isISODate } from "@/lib/dates";
import { detectLinkType, linkTypeMeta, normalizeUrl } from "@/lib/links";
import { MAX_NOTES, toTaskDTO, type CategoryDTO, type LinkDTO, type TaskDTO, type TaskPatch } from "@/lib/taskTypes";

// Visibility rule (TSK-6): a non-admin may only see and change tasks assigned to them.
// Every action below checks it on the server.

const isAdmin = (user: CurrentUser) => user.role === "ADMIN";

async function myEmployeeId(user: CurrentUser): Promise<string | null> {
  const e = await db.employee.findUnique({ where: { email: user.email }, select: { id: true } });
  return e?.id ?? null;
}

async function loadAccessibleTask(user: CurrentUser, id: string) {
  const task = await db.task.findUnique({ where: { id }, include: { assignee: true, links: true } });
  if (!task) throw new Error("Task not found");
  if (!isAdmin(user) && task.assignee?.email !== user.email) throw new Error("That task is not assigned to you");
  return task;
}

async function nextOrder(): Promise<number> {
  const top = await db.task.aggregate({ _max: { sortOrder: true } });
  return (top._max.sortOrder ?? 0) + 1;
}

export async function createTask(input: {
  title: string;
  categoryId?: string | null;
  assigneeId?: string | null;
  inToday?: boolean;
}): Promise<TaskDTO> {
  const user = await requireAccess("tasks", "edit");
  const title = (input.title ?? "").trim().slice(0, 300);
  if (!title) throw new Error("Enter a task title");

  // Non-admins create tasks for themselves; the Admin can create for anyone.
  let assigneeId = input.assigneeId || null;
  if (!isAdmin(user)) assigneeId = await myEmployeeId(user);
  if (assigneeId && !(await db.employee.findUnique({ where: { id: assigneeId } }))) {
    throw new Error("Employee not found");
  }
  if (input.categoryId && !(await db.category.findUnique({ where: { id: input.categoryId } }))) {
    throw new Error("Category not found");
  }

  const task = await db.task.create({
    data: {
      title,
      categoryId: input.categoryId || null,
      assigneeId,
      inToday: input.inToday === true,
      sortOrder: await nextOrder(),
    },
    include: { links: true },
  });
  await audit(user.email, "task.add", title);
  revalidatePath("/tasks");
  return toTaskDTO(task);
}

export async function updateTask(id: string, patch: TaskPatch): Promise<TaskDTO> {
  const user = await requireAccess("tasks", "edit");
  const existing = await loadAccessibleTask(user, id);
  const data: Record<string, unknown> = {};

  if (patch.title !== undefined) {
    const title = patch.title.trim().slice(0, 300);
    if (!title) throw new Error("A task title cannot be blank");
    data.title = title;
  }
  if (patch.notes !== undefined) {
    if (typeof patch.notes !== "string") throw new Error("Invalid notes");
    if (patch.notes.length > MAX_NOTES) throw new Error(`Keep notes to ${MAX_NOTES.toLocaleString()} characters or fewer`);
    data.notes = patch.notes; // editing notes also refreshes the task's updatedAt (Prisma @updatedAt)
  }
  if (patch.categoryId !== undefined) {
    if (patch.categoryId && !(await db.category.findUnique({ where: { id: patch.categoryId } }))) {
      throw new Error("Category not found");
    }
    data.categoryId = patch.categoryId || null;
  }
  if (patch.dueDate !== undefined) {
    if (patch.dueDate && !isISODate(patch.dueDate)) throw new Error("Invalid date");
    data.dueDate = patch.dueDate || null;
  }
  if (patch.expiresAt !== undefined) {
    if (patch.expiresAt && !isISODate(patch.expiresAt)) throw new Error("Invalid expiration date");
    data.expiresAt = patch.expiresAt || null;
  }
  if (patch.completed !== undefined) {
    data.completed = patch.completed === true;
    // Track when it was finished (used by Analytics); clear it if the task is reopened.
    data.completedAt = patch.completed === true ? (existing.completed ? existing.completedAt : new Date()) : null;
  }
  if (patch.inToday !== undefined) data.inToday = patch.inToday === true;

  let reassign = "";
  if (patch.assigneeId !== undefined) {
    const to = patch.assigneeId ? await db.employee.findUnique({ where: { id: patch.assigneeId } }) : null;
    if (patch.assigneeId && !to) throw new Error("Employee not found");
    data.assigneeId = to?.id ?? null;
    if ((to?.id ?? null) !== existing.assigneeId) {
      reassign = `"${existing.title}": ${existing.assignee?.name ?? "unassigned"} -> ${to?.name ?? "unassigned"}`;
    }
  }

  const finalDue = (data.dueDate !== undefined ? data.dueDate : existing.dueDate) as string | null;
  const finalExpires = (data.expiresAt !== undefined ? data.expiresAt : existing.expiresAt) as string | null;
  if (finalDue && finalExpires && finalExpires < finalDue) {
    throw new Error("The expiration date can't be before the due date");
  }

  const updated = await db.task.update({ where: { id }, data, include: { links: true } });
  if (reassign) await audit(user.email, "task.reassign", reassign);
  revalidatePath("/tasks");
  return toTaskDTO(updated);
}

export async function deleteTask(id: string): Promise<void> {
  const user = await requireAccess("tasks", "edit");
  const task = await loadAccessibleTask(user, id);
  await db.task.delete({ where: { id } });
  await audit(user.email, "task.delete", task.title);
  revalidatePath("/tasks");
}

/** Persists drag-and-drop order. Reordering (drag and drop) is an Admin-only ability (TSK-10). */
export async function reorderTasks(orderedIds: string[]): Promise<void> {
  const user = await requireAccess("tasks", "edit");
  if (!isAdmin(user)) throw new Error("Only the administrator can reorder tasks");
  if (orderedIds.length === 0) return;
  const tasks = await db.task.findMany({ where: { id: { in: orderedIds } } });
  if (tasks.length !== new Set(orderedIds).size) throw new Error("Task not found");
  const slots = tasks.map((t) => t.sortOrder).sort((a, b) => a - b);
  const distinct = slots.every((v, i) => i === 0 || v > slots[i - 1]);
  const base = slots[0] ?? 0;
  await db.$transaction(
    orderedIds.map((id, i) => db.task.update({ where: { id }, data: { sortOrder: distinct ? slots[i] : base + i } })),
  );
  revalidatePath("/tasks");
}

export async function addTaskLink(taskId: string, rawUrl: string): Promise<LinkDTO> {
  const user = await requireAccess("tasks", "edit");
  await loadAccessibleTask(user, taskId);
  const url = normalizeUrl(rawUrl);
  if (!url) throw new Error("Enter a valid http(s) link");
  const type = detectLinkType(url);
  const link = await db.taskLink.create({
    data: { taskId, url, type, label: linkTypeMeta(type).label },
  });
  revalidatePath("/tasks");
  return { id: link.id, url: link.url, label: link.label, type: link.type };
}

export async function removeTaskLink(linkId: string): Promise<void> {
  const user = await requireAccess("tasks", "edit");
  const link = await db.taskLink.findUnique({ where: { id: linkId } });
  if (!link) return;
  await loadAccessibleTask(user, link.taskId);
  await db.taskLink.delete({ where: { id: linkId } });
  revalidatePath("/tasks");
}

export async function addCategory(rawName: string): Promise<CategoryDTO> {
  const user = await requireAccess("tasks", "edit");
  const name = rawName.trim().slice(0, 80);
  if (!name) throw new Error("Enter a category name");
  if (await db.category.findUnique({ where: { name } })) throw new Error("That category already exists");
  const cat = await db.category.create({ data: { name, sortOrder: await db.category.count() } });
  await audit(user.email, "category.add", name);
  revalidatePath("/tasks");
  return { id: cat.id, name: cat.name };
}

export async function renameCategory(id: string, rawName: string): Promise<void> {
  await requireAccess("tasks", "edit");
  const name = rawName.trim().slice(0, 80);
  if (!name) throw new Error("Category name cannot be blank");
  const other = await db.category.findUnique({ where: { name } });
  if (other && other.id !== id) throw new Error("That category already exists");
  await db.category.update({ where: { id }, data: { name } });
  revalidatePath("/tasks");
}

/** Deleting a category un-categorizes its tasks (the relation is SET NULL). */
export async function deleteCategory(id: string): Promise<void> {
  const user = await requireAccess("tasks", "edit");
  const cat = await db.category.findUnique({ where: { id } });
  if (!cat) return;
  await db.category.delete({ where: { id } });
  await audit(user.email, "category.delete", cat.name);
  revalidatePath("/tasks");
}
