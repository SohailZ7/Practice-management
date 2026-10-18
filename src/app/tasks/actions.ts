"use server";

import { revalidatePath } from "next/cache";
import { db } from "@/lib/db";
import { audit } from "@/lib/audit";
import { requireAccess } from "@/lib/session";
import { flash, str } from "@/lib/flash";
import { isISODate } from "@/lib/dates";
import { detectLinkType, linkTypeMeta, normalizeUrl } from "@/lib/links";

function back(form: FormData) {
  const scope = str(form, "scope");
  return scope ? `/tasks?scope=${encodeURIComponent(scope)}` : "/tasks";
}

async function nextOrder(): Promise<number> {
  const top = await db.task.aggregate({ _max: { sortOrder: true } });
  return (top._max.sortOrder ?? 0) + 1;
}

export async function addTask(form: FormData) {
  const user = await requireAccess("tasks", "edit");
  const title = str(form, "title");
  if (!title) flash(back(form), "error", "Enter a task title.");
  const task = await db.task.create({
    data: {
      title,
      categoryId: str(form, "categoryId") || null,
      assigneeId: str(form, "assigneeId") || null,
      inToday: str(form, "inToday") === "1",
      sortOrder: await nextOrder(),
    },
  });
  await audit(user.email, "task.add", task.title);
  revalidatePath("/tasks");
}

export async function toggleComplete(form: FormData) {
  await requireAccess("tasks", "edit");
  const id = str(form, "id");
  const task = await db.task.findUnique({ where: { id } });
  if (!task) return;
  await db.task.update({ where: { id }, data: { completed: !task.completed } });
  revalidatePath("/tasks");
}

export async function setTitle(form: FormData) {
  await requireAccess("tasks", "edit");
  const title = str(form, "title");
  if (!title) flash(back(form), "error", "A task title cannot be blank.");
  await db.task.update({ where: { id: str(form, "id") }, data: { title } });
  revalidatePath("/tasks");
}

export async function setCategory(form: FormData) {
  await requireAccess("tasks", "edit");
  await db.task.update({
    where: { id: str(form, "id") },
    data: { categoryId: str(form, "categoryId") || null },
  });
  revalidatePath("/tasks");
}

/** Tasks can be reassigned at any time; every change is audited. */
export async function setAssignee(form: FormData) {
  const user = await requireAccess("tasks", "edit");
  const id = str(form, "id");
  const assigneeId = str(form, "assigneeId") || null;
  const [task, to] = await Promise.all([
    db.task.findUnique({ where: { id }, include: { assignee: true } }),
    assigneeId ? db.employee.findUnique({ where: { id: assigneeId } }) : Promise.resolve(null),
  ]);
  if (!task) return;
  await db.task.update({ where: { id }, data: { assigneeId } });
  await audit(
    user.email,
    "task.reassign",
    `"${task.title}": ${task.assignee?.name ?? "unassigned"} -> ${to?.name ?? "unassigned"}`,
  );
  revalidatePath("/tasks");
}

export async function setDue(form: FormData) {
  await requireAccess("tasks", "edit");
  const due = str(form, "dueDate");
  if (due && !isISODate(due)) flash(back(form), "error", "Invalid date.");
  await db.task.update({ where: { id: str(form, "id") }, data: { dueDate: due || null } });
  revalidatePath("/tasks");
}

export async function toggleToday(form: FormData) {
  await requireAccess("tasks", "edit");
  const id = str(form, "id");
  const task = await db.task.findUnique({ where: { id } });
  if (!task) return;
  await db.task.update({ where: { id }, data: { inToday: !task.inToday } });
  revalidatePath("/tasks");
}

export async function deleteTask(form: FormData) {
  const user = await requireAccess("tasks", "edit");
  const id = str(form, "id");
  const task = await db.task.findUnique({ where: { id } });
  await db.task.delete({ where: { id } }).catch(() => undefined);
  if (task) await audit(user.email, "task.delete", task.title);
  revalidatePath("/tasks");
}

export async function addLink(form: FormData) {
  await requireAccess("tasks", "edit");
  const url = normalizeUrl(str(form, "url"));
  if (!url) flash(back(form), "error", "Enter a valid http(s) link.");
  const type = detectLinkType(url);
  await db.taskLink.create({
    data: { taskId: str(form, "id"), url, type, label: linkTypeMeta(type).label },
  });
  revalidatePath("/tasks");
}

export async function removeLink(form: FormData) {
  await requireAccess("tasks", "edit");
  await db.taskLink.delete({ where: { id: str(form, "linkId") } }).catch(() => undefined);
  revalidatePath("/tasks");
}

/** Moves a task up or down within the visible list it sits in. `order` is that list's ids. */
export async function moveTask(form: FormData) {
  await requireAccess("tasks", "edit");
  const id = str(form, "id");
  const dir = str(form, "dir") === "up" ? -1 : 1;
  const ids = str(form, "order").split(",").filter(Boolean);
  const from = ids.indexOf(id);
  const to = from + dir;
  if (from < 0 || to < 0 || to >= ids.length) return;

  const rows = await db.task.findMany({ where: { id: { in: ids } }, select: { id: true, sortOrder: true } });
  const orderById = new Map(rows.map((r) => [r.id, r.sortOrder]));
  const slots = ids.map((i) => orderById.get(i) ?? 0).sort((a, b) => a - b);
  const base = slots[0] ?? 0;
  const reordered = [...ids];
  [reordered[from], reordered[to]] = [reordered[to], reordered[from]];
  const strictlyIncreasing = slots.every((v, i) => i === 0 || v > slots[i - 1]);
  await db.$transaction(
    reordered.map((taskId, i) =>
      db.task.update({
        where: { id: taskId },
        data: { sortOrder: strictlyIncreasing ? slots[i] : base + i },
      }),
    ),
  );
  revalidatePath("/tasks");
}

export async function addCategory(form: FormData) {
  const user = await requireAccess("tasks", "edit");
  const name = str(form, "name");
  if (!name) flash(back(form), "error", "Enter a category name.");
  if (await db.category.findUnique({ where: { name } })) flash(back(form), "error", "That category already exists.");
  await db.category.create({ data: { name, sortOrder: await db.category.count() } });
  await audit(user.email, "category.add", name);
  revalidatePath("/tasks");
}

export async function renameCategory(form: FormData) {
  await requireAccess("tasks", "edit");
  const name = str(form, "name");
  if (!name) flash(back(form), "error", "Category name cannot be blank.");
  const id = str(form, "id");
  const other = await db.category.findUnique({ where: { name } });
  if (other && other.id !== id) flash(back(form), "error", "That category already exists.");
  await db.category.update({ where: { id }, data: { name } });
  revalidatePath("/tasks");
}

/** Deleting a category un-categorizes its tasks (the relation is SET NULL). */
export async function deleteCategory(form: FormData) {
  const user = await requireAccess("tasks", "edit");
  const id = str(form, "id");
  const cat = await db.category.findUnique({ where: { id } });
  await db.category.delete({ where: { id } }).catch(() => undefined);
  if (cat) await audit(user.email, "category.delete", cat.name);
  revalidatePath("/tasks");
}
