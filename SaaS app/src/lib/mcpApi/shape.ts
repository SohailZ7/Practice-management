// Pure input parsing and output shaping for the tasks API. No database, so it is unit-tested directly.
import { isISODate } from "../dates";
import { detectPhi } from "../phiGuard";
import { MAX_NOTES } from "../taskTypes";

export const PHI_WITHHELD = "[withheld: possible patient info]";

export type TaskOut = {
  id: string;
  title: string;
  notes?: string;
  hasNotes: boolean;
  assigneeId: string | null;
  categoryId: string | null;
  dueDate: string | null;
  done: boolean;
  phiWithheld?: string[];
};

type Row = { id: string; title: string; notes: string; assigneeId: string | null; categoryId: string | null; dueDate: string | null; completed: boolean };

/**
 * What leaves the app for Claude. Old tasks may predate the PHI guard, so title and notes that look like they hold an
 * identifier are withheld (only the kinds are named). List results omit notes; a single task includes them.
 */
export function toTaskOut(t: Row, opts: { withNotes: boolean; ignoreEmails?: string[] }): TaskOut {
  const findings = detectPhi(`${t.title}\n${t.notes}`, { ignoreEmails: opts.ignoreEmails });
  const out: TaskOut = {
    id: t.id,
    title: t.title,
    hasNotes: t.notes.length > 0,
    assigneeId: t.assigneeId,
    categoryId: t.categoryId,
    dueDate: t.dueDate,
    done: t.completed,
  };
  if (findings.length) {
    out.title = PHI_WITHHELD;
    out.phiWithheld = findings.map((f) => f.kind);
  } else if (opts.withNotes) {
    out.notes = t.notes;
  }
  return out;
}

export type ListQuery = { status: "open" | "done" | "all"; assigneeId?: string; dueBefore?: string; limit: number };

export function parseListQuery(sp: URLSearchParams): ListQuery {
  const status = sp.get("status") ?? "open";
  if (status !== "open" && status !== "done" && status !== "all") throw new Error("status must be open, done or all");
  const dueBefore = sp.get("dueBefore") ?? undefined;
  if (dueBefore && !isISODate(dueBefore)) throw new Error("dueBefore must be YYYY-MM-DD");
  const limit = Math.min(200, Math.max(1, Math.floor(Number(sp.get("limit") ?? 50)) || 50));
  return { status, assigneeId: sp.get("assigneeId") || undefined, dueBefore, limit };
}

export type CreateInput = { title: string; notes?: string; dueDate?: string | null; assigneeId?: string | null; categoryId?: string | null };
export type UpdateInput = Partial<{ title: string; notes: string; dueDate: string | null; assigneeId: string | null; categoryId: string | null; done: boolean }>;

const isStrOrNull = (v: unknown) => v === null || typeof v === "string";

/** Only known keys are read; anything else in the body is ignored. Throws Error(message) on bad values. */
export function parseTaskBody(body: Record<string, unknown>, mode: "create" | "update"): CreateInput & UpdateInput {
  const out = {} as CreateInput & UpdateInput;
  if (body.title !== undefined) {
    if (typeof body.title !== "string" || !body.title.trim()) throw new Error("title must be non-empty text");
    out.title = body.title.trim().slice(0, 300);
  } else if (mode === "create") {
    throw new Error("title is required");
  }
  if (body.notes !== undefined) {
    if (typeof body.notes !== "string") throw new Error("notes must be text");
    if (body.notes.length > MAX_NOTES) throw new Error(`notes must be ${MAX_NOTES} characters or fewer`);
    out.notes = body.notes;
  }
  for (const k of ["dueDate", "assigneeId", "categoryId"] as const) {
    if (body[k] === undefined) continue;
    if (!isStrOrNull(body[k])) throw new Error(`${k} must be text or null`);
    const v = (body[k] as string | null) || null;
    if (k === "dueDate" && v && !isISODate(v)) throw new Error("dueDate must be YYYY-MM-DD");
    out[k] = v;
  }
  if (body.done !== undefined) {
    if (typeof body.done !== "boolean") throw new Error("done must be true or false");
    if (mode === "create") throw new Error("done is only valid when updating");
    out.done = body.done;
  }
  return out;
}
