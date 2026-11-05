// Tasks operations for the MCP API. Mirrors the rules in src/app/tasks/actions.ts (the web app's server actions need a
// browser session, so they cannot be called here): the same access scope, PHI check, assignee rules and audit trail.
// Every call is audited with ids and counts only, never task text.
import { db } from "../db";
import { audit } from "../audit";
import { canAssignTo } from "../taskAccess";
import { loadTaskScope } from "../taskScope";
import { phiCheck } from "../phiCheck";
import type { CurrentUser } from "../session";
import { ApiError } from "./http";
import { parseListQuery, parseTaskBody, toTaskOut, type ListQuery } from "./shape";

const UNASSIGNED = "Unassigned";
const isAdmin = (u: CurrentUser) => u.role === "ADMIN";

async function staffEmails(): Promise<string[]> {
  const [users, employees] = await Promise.all([db.user.findMany({ select: { email: true } }), db.employee.findMany({ where: { email: { not: null } }, select: { email: true } })]);
  return [...users.map((u) => u.email), ...employees.map((e) => e.email!)];
}

async function loadEditable(user: CurrentUser, tokenId: string, id: string) {
  const task = await db.task.findUnique({ where: { id }, include: { assignee: true } });
  if (!task) throw new ApiError(404, "not_found");
  if (!isAdmin(user) && task.assignee?.email !== user.email) {
    const scope = await loadTaskScope(user);
    if (!task.assigneeId || !scope.editIds.includes(task.assigneeId)) {
      await audit(user.email, "mcp.denied", `token ${tokenId} task ${id}`);
      throw new ApiError(403, "forbidden");
    }
  }
  return task;
}

const wrap = async <T>(fn: () => Promise<T>): Promise<T> => {
  try {
    return await fn();
  } catch (e) {
    if (e instanceof ApiError) throw e;
    // Validation errors thrown by parsers carry safe, generic messages. Database errors are not Error subclasses we trust.
    if (e instanceof Error && e.constructor === Error) throw new ApiError(400, "invalid", { message: e.message });
    throw e;
  }
};

export async function listTasks(user: CurrentUser, tokenId: string, sp: URLSearchParams) {
  const q: ListQuery = await wrap(async () => parseListQuery(sp));
  const scope = await loadTaskScope(user);
  const where: Record<string, unknown> = {};
  if (q.status !== "all") where.completed = q.status === "done";
  if (q.dueBefore) where.dueDate = { lt: q.dueBefore, not: null };
  if (!isAdmin(user)) where.assigneeId = { in: scope.viewIds };
  if (q.assigneeId) {
    const id = q.assigneeId === "me" ? scope.meId : q.assigneeId;
    if (!isAdmin(user) && !(id && scope.viewIds.includes(id))) throw new ApiError(403, "forbidden");
    where.assigneeId = id ?? "__none__";
  }
  const rows = await db.task.findMany({ where, orderBy: [{ sortOrder: "asc" }], take: q.limit });
  const emails = await staffEmails();
  await audit(user.email, "mcp.task.list", `token ${tokenId} status=${q.status} count=${rows.length}`);
  return { tasks: rows.map((t) => toTaskOut(t, { withNotes: false, ignoreEmails: emails })) };
}

export async function getTask(user: CurrentUser, tokenId: string, id: string) {
  const task = await db.task.findUnique({ where: { id }, include: { assignee: true } });
  if (!task) throw new ApiError(404, "not_found");
  if (!isAdmin(user)) {
    const scope = await loadTaskScope(user);
    if (!task.assigneeId || !scope.viewIds.includes(task.assigneeId)) {
      await audit(user.email, "mcp.denied", `token ${tokenId} task ${id}`);
      throw new ApiError(403, "forbidden");
    }
  }
  await audit(user.email, "mcp.task.get", `token ${tokenId} task ${id}`);
  return { task: toTaskOut(task, { withNotes: true, ignoreEmails: await staffEmails() }) };
}

export async function createTask(user: CurrentUser, tokenId: string, body: Record<string, unknown>) {
  const input = await wrap(async () => parseTaskBody(body, "create"));
  const scope = await loadTaskScope(user);
  let assigneeId = input.assigneeId ?? null;
  if (!isAdmin(user) && !assigneeId) assigneeId = scope.meId;
  if (!canAssignTo({ isAdmin: isAdmin(user), targetId: assigneeId, tabIds: scope.tabIds })) {
    throw new ApiError(400, "invalid", { message: assigneeId ? "That employee has no task tab" : "Choose who the task is for" });
  }
  if (input.categoryId && !(await db.category.findUnique({ where: { id: input.categoryId } }))) throw new ApiError(400, "invalid", { message: "Category not found" });
  // The API can never confirm "no patient information": a flagged title or note is refused outright.
  const blocked = await phiCheck(user, null, [input.title!, input.notes ?? ""], false);
  if (blocked) throw new ApiError(422, "phi_blocked", { message: blocked.message, kinds: blocked.kinds });

  const top = await db.task.aggregate({ _max: { sortOrder: true } });
  const task = await db.task.create({
    data: { title: input.title!, notes: input.notes ?? "", dueDate: input.dueDate ?? null, categoryId: input.categoryId ?? null, assigneeId, sortOrder: (top._max.sortOrder ?? 0) + 1 },
  });
  await audit(user.email, "mcp.task.add", `token ${tokenId} task ${task.id}`);
  if (assigneeId !== scope.meId) {
    const to = scope.tabs.find((e) => e.id === assigneeId);
    await db.taskMove.create({ data: { taskId: task.id, fromId: null, fromName: "New task", toId: assigneeId, toName: to?.name ?? UNASSIGNED, kind: "created-for", movedBy: user.email } });
    await audit(user.email, "task.reassign", `task ${task.id}: New task -> ${to?.name ?? UNASSIGNED}`);
  }
  return { task: toTaskOut(task, { withNotes: true }) };
}

export async function updateTask(user: CurrentUser, tokenId: string, id: string, body: Record<string, unknown>) {
  const patch = await wrap(async () => parseTaskBody(body, "update"));
  const existing = await loadEditable(user, tokenId, id);
  const changedText = [patch.title !== undefined && patch.title !== existing.title ? patch.title : "", patch.notes !== undefined && patch.notes !== existing.notes ? patch.notes : ""];
  const blocked = await phiCheck(user, id, changedText, false);
  if (blocked) throw new ApiError(422, "phi_blocked", { message: blocked.message, kinds: blocked.kinds });

  const data: Record<string, unknown> = {};
  if (patch.title !== undefined) data.title = patch.title;
  if (patch.notes !== undefined) data.notes = patch.notes;
  if (patch.dueDate !== undefined) data.dueDate = patch.dueDate;
  if (patch.categoryId !== undefined) {
    if (patch.categoryId && !(await db.category.findUnique({ where: { id: patch.categoryId } }))) throw new ApiError(400, "invalid", { message: "Category not found" });
    data.categoryId = patch.categoryId;
  }
  if (patch.done !== undefined) {
    data.completed = patch.done;
    data.completedAt = patch.done ? (existing.completed ? existing.completedAt : new Date()) : null;
  }
  let move: { id: string | null; name: string } | null = null;
  if (patch.assigneeId !== undefined) {
    const scope = await loadTaskScope(user);
    const target = patch.assigneeId;
    const to = target ? scope.tabs.find((e) => e.id === target) : null;
    if (!canAssignTo({ isAdmin: isAdmin(user), targetId: target, tabIds: scope.tabIds })) {
      throw new ApiError(400, "invalid", { message: target ? "That employee has no task tab" : "Only the administrator can unassign a task" });
    }
    data.assigneeId = to?.id ?? null;
    if ((to?.id ?? null) !== existing.assigneeId) move = { id: to?.id ?? null, name: to?.name ?? UNASSIGNED };
  }
  if (Object.keys(data).length === 0) throw new ApiError(400, "invalid", { message: "Nothing to change" });

  const updated = await db.task.update({ where: { id }, data });
  const fields = Object.keys(data).filter((k) => k !== "completedAt").join(",");
  await audit(user.email, "mcp.task.update", `token ${tokenId} task ${id} fields=${fields}`);
  if (move) {
    const from = { id: existing.assigneeId, name: existing.assignee?.name ?? UNASSIGNED };
    await db.taskMove.create({ data: { taskId: id, fromId: from.id, fromName: from.name, toId: move.id, toName: move.name, kind: "assigned", movedBy: user.email } });
    await audit(user.email, "task.reassign", `task ${id}: ${from.name} -> ${move.name}`);
  }
  return { task: toTaskOut(updated, { withNotes: true }) };
}

export async function deleteTask(user: CurrentUser, tokenId: string, id: string) {
  await loadEditable(user, tokenId, id);
  await db.task.delete({ where: { id } });
  await audit(user.email, "mcp.task.delete", `token ${tokenId} task ${id}`);
  return { deleted: id };
}

/** Employees who have a task tab (assignable) and the categories: names only. */
export async function taskOptions(user: CurrentUser, tokenId: string) {
  const scope = await loadTaskScope(user);
  const categories = await db.category.findMany({ orderBy: { sortOrder: "asc" }, select: { id: true, name: true } });
  await audit(user.email, "mcp.task.options", `token ${tokenId}`);
  return {
    me: scope.meId,
    people: scope.tabs.map((e) => ({ id: e.id, name: e.name })),
    categories,
    canUnassign: isAdmin(user),
  };
}
