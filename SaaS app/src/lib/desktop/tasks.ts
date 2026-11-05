// Desktop recorder: Feedback "Promote" and the lightweight My Tasks list. Thin layer over the existing logic:
// promoteItems (staging only) and the MCP tasks service, so scope, PHI check, assignee rules and audit are the web app's.
import { db } from "../db";
import type { CurrentUser } from "../session";
import { ApiError as McpApiError } from "../mcpApi/http";
import { createTask, listTasks, updateTask } from "../mcpApi/tasksService";
import { PromoteConfigError, promoteItems } from "../promote/send";
import { isStaging } from "../promote/rules";
import { ApiError } from "./api";

export const MAX_TITLE = 300;

/** Re-throws the MCP service's errors as desktop errors (same status and code). */
async function mapped<T>(fn: () => Promise<T>): Promise<T> {
  try {
    return await fn();
  } catch (e) {
    if (e instanceof McpApiError) throw new ApiError(e.status, e.code);
    throw e;
  }
}

type DesktopTask = { id: string; title: string; dueDate: string | null; status: "open" | "done"; createdAt: string };

const shape = (t: { id: string; title: string; dueDate: string | null; done: boolean }, createdAt: Date | undefined): DesktopTask => ({
  id: t.id,
  title: t.title,
  dueDate: t.dueDate,
  status: t.done ? "done" : "open",
  createdAt: (createdAt ?? new Date(0)).toISOString(),
});

async function createdAtOf(ids: string[]): Promise<Map<string, Date>> {
  if (ids.length === 0) return new Map();
  const rows = (await db.task.findMany({ where: { id: { in: ids } }, select: { id: true, createdAt: true } })) as { id: string; createdAt: Date }[];
  return new Map(rows.map((r) => [r.id, r.createdAt]));
}

export async function desktopListTasks(user: CurrentUser, sessionId: string, status: string | null) {
  const sp = new URLSearchParams({ status: status ?? "open", limit: "200" });
  const { tasks } = await mapped(() => listTasks(user, `desktop ${sessionId}`, sp));
  const made = await createdAtOf(tasks.map((t) => t.id));
  return { tasks: tasks.map((t) => shape(t, made.get(t.id))) };
}

export async function desktopCreateTask(user: CurrentUser, sessionId: string, body: Record<string, unknown>) {
  const title = typeof body.title === "string" ? body.title.trim() : "";
  if (!title || title.length > MAX_TITLE) throw new ApiError(400, "bad_title");
  const input: Record<string, unknown> = { title };
  if (body.dueDate !== undefined) input.dueDate = body.dueDate;
  const { task } = await mapped(() => createTask(user, `desktop ${sessionId}`, input));
  const made = await createdAtOf([task.id]);
  return shape(task, made.get(task.id));
}

export async function desktopUpdateTask(user: CurrentUser, sessionId: string, id: string, body: Record<string, unknown>) {
  const patch: Record<string, unknown> = {};
  if (body.title !== undefined) {
    const t = typeof body.title === "string" ? body.title.trim() : "";
    if (!t || t.length > MAX_TITLE) throw new ApiError(400, "bad_title");
    patch.title = t;
  }
  if (body.dueDate !== undefined) patch.dueDate = body.dueDate;
  if (body.status !== undefined) {
    if (body.status !== "open" && body.status !== "done") throw new ApiError(400, "bad_status");
    patch.done = body.status === "done";
  }
  const { task } = await mapped(() => updateTask(user, `desktop ${sessionId}`, id, patch));
  const made = await createdAtOf([task.id]);
  return shape(task, made.get(task.id));
}

/** Staging only. Admin only, like the web Promote page. Reuses promoteItems (test items skipped, idempotent by sourceId, same audit). */
export async function desktopPromoteFeedback(user: CurrentUser, id: string): Promise<{ promoted: true; promotedAt: string }> {
  if (!isStaging()) throw new ApiError(404, "not_found");
  if (user.role !== "ADMIN") throw new ApiError(403, "forbidden");
  let r;
  try {
    [r] = await promoteItems(user.email, "feedback", [id]);
  } catch (e) {
    if (e instanceof PromoteConfigError) throw new ApiError(502, "promote_failed");
    throw e;
  }
  if (!r) throw new ApiError(502, "promote_failed");
  if (!r.ok) {
    if (r.error === "not_found") throw new ApiError(404, "not_found");
    if (r.error === "already_promoted") throw new ApiError(409, "already_promoted");
    if (r.error === "test_item") throw new ApiError(409, "is_test_item");
    throw new ApiError(502, "promote_failed");
  }
  const row = await db.feedbackItem.findUnique({ where: { id } });
  return { promoted: true, promotedAt: (row?.promotedAt ?? new Date()).toISOString() };
}
