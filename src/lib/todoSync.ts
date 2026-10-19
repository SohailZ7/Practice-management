// One-way sync of a Sohail Todo App category into the Tasks module. Pure planning code (no database or
// network) so it is easy to test; see todoSyncService.ts for the part that talks to Firestore and Prisma.
//
// The Todo App is the master. For each of its todos in the chosen category:
//   - a matching task is updated to the Todo App's values (title, notes, due date, done, Today, links);
//   - a todo with no task yet creates one;
//   - a task created before syncing existed is adopted by an exact title match instead of duplicated;
//   - a still-open task whose todo has been deleted (or moved out of the category) is removed;
//     finished tasks are kept as history.
// Fields the Todo App doesn't own stay as they are here: assignee, expiration date and category label.
import { normalizeUrl } from "./links";

export const TODO_SOURCE = "todo-app";

// ---------- Reading the Firestore document ----------

type FsValue = Record<string, unknown>;

/** Converts a Firestore REST value ({ stringValue: ... }, { mapValue: ... }, ...) to plain JSON. */
export function decodeFirestoreValue(v: FsValue): unknown {
  if ("stringValue" in v) return v.stringValue;
  if ("integerValue" in v) return Number(v.integerValue);
  if ("doubleValue" in v) return Number(v.doubleValue);
  if ("booleanValue" in v) return v.booleanValue;
  if ("nullValue" in v) return null;
  if ("timestampValue" in v) return v.timestampValue;
  if ("arrayValue" in v) {
    const values = ((v.arrayValue as { values?: FsValue[] }).values ?? []).map(decodeFirestoreValue);
    return values;
  }
  if ("mapValue" in v) {
    const fields = (v.mapValue as { fields?: Record<string, FsValue> }).fields ?? {};
    return Object.fromEntries(Object.entries(fields).map(([k, x]) => [k, decodeFirestoreValue(x)]));
  }
  return null;
}

export type SourceTodo = {
  id: string;
  title: string;
  notes: string;
  categoryId: string | null;
  dueDate: string | null;
  completed: boolean;
  completedAt: number | null;
  inToday: boolean;
  links: string[];
};

export type SourceState = { categories: { id: string; name: string }[]; todos: SourceTodo[] };

/** Validates the decoded Todo App state and keeps only what we use. Throws on an unexpected shape. */
export function parseTodoState(raw: unknown): SourceState {
  const o = raw as { categories?: unknown; todos?: unknown } | null;
  if (!o || !Array.isArray(o.categories) || !Array.isArray(o.todos)) throw new Error("Unexpected Todo App data shape");
  const categories = o.categories.flatMap((c) => {
    const x = c as { id?: unknown; name?: unknown };
    return typeof x?.id === "string" && typeof x?.name === "string" ? [{ id: x.id, name: x.name }] : [];
  });
  const todos = o.todos.flatMap((t) => {
    const x = t as Record<string, unknown>;
    if (typeof x?.id !== "string" || typeof x?.title !== "string") return [];
    const dueDate = typeof x.dueDate === "string" && /^\d{4}-\d{2}-\d{2}$/.test(x.dueDate) ? x.dueDate : null;
    const links = Array.isArray(x.links)
      ? x.links.flatMap((l) => {
          const url = normalizeUrl(String((l as { url?: unknown })?.url ?? ""));
          return url ? [url] : [];
        })
      : [];
    return [
      {
        id: x.id,
        title: x.title.trim(),
        notes: typeof x.notes === "string" ? x.notes : "",
        categoryId: typeof x.categoryId === "string" ? x.categoryId : null,
        dueDate,
        completed: x.completed === true,
        completedAt: typeof x.completedAt === "number" ? x.completedAt : null,
        inToday: x.inToday === true,
        links,
      },
    ];
  });
  return { categories, todos };
}

// ---------- Planning ----------

export type ExistingTask = {
  id: string;
  title: string;
  notes: string;
  dueDate: string | null;
  completed: boolean;
  completedAt: number | null;
  inToday: boolean;
  externalId: string | null;
  linkUrls: string[];
};

export type TaskValues = {
  title: string;
  notes: string;
  dueDate: string | null;
  completed: boolean;
  completedAt: number | null;
  inToday: boolean;
};

export type SyncPlan = {
  create: { externalId: string; values: TaskValues; links: string[] }[];
  update: { id: string; externalId: string; values: Partial<TaskValues>; links?: string[] }[];
  remove: string[];
  unchanged: number;
};

const sameLinks = (a: string[], b: string[]) => a.length === b.length && [...a].sort().join("\n") === [...b].sort().join("\n");
const key = (title: string) => title.trim().toLowerCase();

export function planTodoSync(source: SourceTodo[], existing: ExistingTask[]): SyncPlan {
  const plan: SyncPlan = { create: [], update: [], remove: [], unchanged: 0 };
  const byExternal = new Map(existing.filter((t) => t.externalId).map((t) => [t.externalId!, t]));
  const sourceIds = new Set(source.map((s) => s.id));

  // Tasks made before syncing existed can be adopted by title, each at most once.
  const adoptable = new Map<string, ExistingTask[]>();
  for (const t of existing.filter((t) => !t.externalId)) adoptable.set(key(t.title), [...(adoptable.get(key(t.title)) ?? []), t]);

  for (const s of source) {
    let match = byExternal.get(s.id);
    if (!match) {
      const candidates = adoptable.get(key(s.title)) ?? [];
      match = candidates.shift();
    }
    if (!match) {
      plan.create.push({
        externalId: s.id,
        values: { title: s.title, notes: s.notes, dueDate: s.dueDate, completed: s.completed, completedAt: s.completed ? s.completedAt : null, inToday: s.inToday },
        links: s.links,
      });
      continue;
    }

    const values: Partial<TaskValues> = {};
    if (match.title !== s.title) values.title = s.title;
    if (match.notes !== s.notes) values.notes = s.notes;
    if (match.dueDate !== s.dueDate) values.dueDate = s.dueDate;
    if (match.inToday !== s.inToday) values.inToday = s.inToday;
    if (match.completed !== s.completed) {
      values.completed = s.completed;
      values.completedAt = s.completed ? s.completedAt : null;
    } else if (s.completed && s.completedAt !== null && match.completedAt !== s.completedAt) {
      values.completedAt = s.completedAt;
    }
    const linksChanged = !sameLinks(match.linkUrls, s.links);
    const adopting = match.externalId !== s.id;
    if (Object.keys(values).length === 0 && !linksChanged && !adopting) {
      plan.unchanged++;
    } else {
      plan.update.push({ id: match.id, externalId: s.id, values, ...(linksChanged ? { links: s.links } : {}) });
    }
  }

  // Open mirrored tasks that are gone from the Todo App are removed; finished ones stay as history.
  for (const t of existing) {
    if (t.externalId && !sourceIds.has(t.externalId) && !t.completed) plan.remove.push(t.id);
  }
  return plan;
}
