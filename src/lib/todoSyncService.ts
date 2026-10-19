import { execFile } from "node:child_process";
import { promisify } from "node:util";
import { db } from "./db";
import { audit } from "./audit";
import { detectLinkType, linkTypeMeta } from "./links";
import { decodeFirestoreValue, parseTodoState, planTodoSync, TODO_SOURCE, type SourceState } from "./todoSync";

const run = promisify(execFile);

/** The Todo App's Google Cloud project (its Firestore holds the master list). */
export const TODO_APP_PROJECT = process.env.TODO_APP_PROJECT_ID || "sohail-todo-app";
/** Which Todo App category is mirrored. */
export const TODO_SYNC_CATEGORY = process.env.TODO_SYNC_CATEGORY || "B & BC";

/**
 * A read-only token for the Todo App's Firestore:
 *  1. TODO_APP_ACCESS_TOKEN, if set;
 *  2. on Cloud Run, the service account (it needs roles/datastore.viewer on the Todo App's project);
 *  3. when not in production, the signed-in `gcloud` user (for running locally).
 */
async function accessToken(): Promise<string> {
  if (process.env.TODO_APP_ACCESS_TOKEN) return process.env.TODO_APP_ACCESS_TOKEN;
  try {
    const res = await fetch("http://metadata.google.internal/computeMetadata/v1/instance/service-accounts/default/token", {
      headers: { "Metadata-Flavor": "Google" },
      signal: AbortSignal.timeout(1500),
    });
    if (res.ok) return ((await res.json()) as { access_token: string }).access_token;
  } catch {
    // not on Google Cloud
  }
  if (process.env.NODE_ENV !== "production") {
    try {
      const { stdout } = await run("gcloud", ["auth", "print-access-token"], { timeout: 15000 });
      if (stdout.trim()) return stdout.trim();
    } catch {
      // fall through
    }
  }
  throw new Error(
    "Can't sign in to the Todo App's data. Locally, run `gcloud auth login`; on Cloud Run, give the service account Cloud Datastore Viewer on the Todo App project.",
  );
}

export async function fetchTodoState(): Promise<SourceState> {
  const token = await accessToken();
  const url = `https://firestore.googleapis.com/v1/projects/${TODO_APP_PROJECT}/databases/(default)/documents/app/state`;
  const res = await fetch(url, { headers: { Authorization: `Bearer ${token}` }, cache: "no-store" });
  if (res.status === 403 || res.status === 401) throw new Error("The Todo App's data refused access. Check the Google account or service account permissions.");
  if (!res.ok) throw new Error(`Couldn't read the Todo App (HTTP ${res.status}).`);
  const doc = (await res.json()) as { fields?: Record<string, Record<string, unknown>> };
  return parseTodoState(decodeFirestoreValue({ mapValue: { fields: doc.fields ?? {} } }));
}

export type SyncResult = { created: number; updated: number; removed: number; unchanged: number };

/** Mirrors the Todo App's category into the given employee's tasks (one-way). */
export async function syncFromTodoApp(assigneeId: string, actorEmail: string): Promise<SyncResult> {
  const state = await fetchTodoState();
  const source = state.categories.find((c) => c.name === TODO_SYNC_CATEGORY);
  if (!source) throw new Error(`The Todo App has no "${TODO_SYNC_CATEGORY}" category.`);
  const todos = state.todos.filter((t) => t.categoryId === source.id);

  const category = await db.category.upsert({
    where: { name: TODO_SYNC_CATEGORY },
    update: {},
    create: { name: TODO_SYNC_CATEGORY, sortOrder: await db.category.count() },
  });

  const result = await db.$transaction(
    async (tx) => {
      const rows = await tx.task.findMany({
        where: {
          assigneeId,
          OR: [{ externalSource: TODO_SOURCE }, { externalSource: null, categoryId: category.id }],
        },
        include: { links: true },
      });
      const plan = planTodoSync(
        todos,
        rows.map((t) => ({
          id: t.id,
          title: t.title,
          notes: t.notes,
          dueDate: t.dueDate,
          completed: t.completed,
          completedAt: t.completedAt ? t.completedAt.getTime() : null,
          inToday: t.inToday,
          externalId: t.externalSource === TODO_SOURCE ? t.externalId : null,
          linkUrls: t.links.map((l) => l.url),
        })),
      );

      const linkRows = (urls: string[]) =>
        urls.map((url) => {
          const type = detectLinkType(url);
          return { url, type, label: linkTypeMeta(type).label };
        });
      const toDate = (ms: number | null | undefined) => (ms === null || ms === undefined ? null : new Date(ms));

      const top = await tx.task.aggregate({ _max: { sortOrder: true } });
      let order = (top._max.sortOrder ?? 0) + 1;
      for (const c of plan.create) {
        await tx.task.create({
          data: {
            title: c.values.title,
            notes: c.values.notes,
            dueDate: c.values.dueDate,
            completed: c.values.completed,
            completedAt: toDate(c.values.completedAt),
            inToday: c.values.inToday,
            assigneeId,
            categoryId: category.id,
            sortOrder: order++,
            externalSource: TODO_SOURCE,
            externalId: c.externalId,
            links: { create: linkRows(c.links) },
          },
        });
      }
      for (const u of plan.update) {
        const { completedAt, ...rest } = u.values;
        await tx.task.update({
          where: { id: u.id },
          data: {
            ...rest,
            ...(completedAt !== undefined ? { completedAt: toDate(completedAt) } : {}),
            externalSource: TODO_SOURCE,
            externalId: u.externalId,
            categoryId: category.id,
          },
        });
        if (u.links) {
          await tx.taskLink.deleteMany({ where: { taskId: u.id } });
          await tx.taskLink.createMany({ data: linkRows(u.links).map((l) => ({ ...l, taskId: u.id })) });
        }
      }
      if (plan.remove.length) await tx.task.deleteMany({ where: { id: { in: plan.remove } } });
      return { created: plan.create.length, updated: plan.update.length, removed: plan.remove.length, unchanged: plan.unchanged };
    },
    { timeout: 60000, maxWait: 10000 },
  );

  await audit(actorEmail, "todo.sync", `${TODO_SYNC_CATEGORY}: ${result.created} new, ${result.updated} updated, ${result.removed} removed, ${result.unchanged} unchanged`);
  return result;
}

export async function lastSyncAt(): Promise<Date | null> {
  const row = await db.auditLog.findFirst({ where: { action: "todo.sync" }, orderBy: { createdAt: "desc" } });
  return row?.createdAt ?? null;
}
