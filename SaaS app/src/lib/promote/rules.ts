// Pure rules for "Promote to production" (docs/promote-to-production.md). No database or network, so it is unit-tested directly.
// The feature exists only when APP_ENV=staging (sending side). The receiving endpoint exists only on a deployment that is
// NOT staging and has PROMOTE_SERVICE_KEY set. Scope: tasks and feedback only, never patient data, never test items.
import { createHash, timingSafeEqual } from "node:crypto";
import { isISODate } from "../dates";
import { detectPhi } from "../phiGuard";
import { MAX_NOTES } from "../taskTypes";
import { KINDS, MAX_DESCRIPTION, MAX_TITLE, type FeedbackKind } from "../feedback/rules";

export const PROMOTE_KINDS = ["task", "feedback"] as const;
export type PromoteKind = (typeof PROMOTE_KINDS)[number];
export const MAX_BULK = 50;
export const MAX_BODY = 60_000;

type Env = Record<string, string | undefined>;

/** True only on the staging deployment (APP_ENV=staging). Everything that sends or shows the button checks this. */
export const isStaging = (env: Env = process.env): boolean => env.APP_ENV === "staging";

/** The receiver is on only where it is not staging and a key (32+ characters) is configured. Otherwise the route answers 404. */
export const receiverEnabled = (env: Env = process.env): boolean => !isStaging(env) && (env.PROMOTE_SERVICE_KEY?.length ?? 0) >= 32;

/** Constant-time comparison of the presented bearer against the configured key (hashes first, so lengths never leak). */
export function keyMatches(header: string | null | undefined, key: string | undefined): boolean {
  const m = /^Bearer\s+(\S+)$/.exec(header ?? "");
  const a = createHash("sha256").update(m ? m[1] : "").digest();
  const b = createHash("sha256").update(key ?? "").digest();
  return timingSafeEqual(a, b) && !!m && !!key;
}

export type TaskPayload = { title: string; notes: string; dueDate: string | null; expiresAt: string | null; completed: boolean; categoryName: string | null; assigneeEmail: string | null };
export type FeedbackPayload = { kind: FeedbackKind; title: string; description: string; authorEmail: string | null };
export type Parsed = { kind: "task"; sourceId: string; item: TaskPayload } | { kind: "feedback"; sourceId: string; item: FeedbackPayload };
export type ParseResult = { ok: true; value: Parsed } | { ok: false; status: 400 | 422; error: string; kinds?: string[] };

const SOURCE_ID = /^[A-Za-z0-9_-]{1,64}$/;
const isObj = (v: unknown): v is Record<string, unknown> => !!v && typeof v === "object" && !Array.isArray(v);
/** undefined = invalid, null = absent/empty. */
const optStr = (v: unknown, max: number): string | null | undefined => (v === undefined || v === null ? null : typeof v === "string" && v.length <= max ? v.trim() || null : undefined);
const bad = (error: string): ParseResult => ({ ok: false, status: 400, error });

function phiKinds(...texts: string[]): string[] {
  return Array.from(new Set(detectPhi(texts.join("\n")).map((f) => f.kind)));
}

/** Validates a request body. Unknown keys are ignored; test items and patient-looking text are refused. */
export function parsePromote(body: unknown): ParseResult {
  if (!isObj(body)) return bad("bad_request");
  const { kind, sourceId, item } = body;
  if (typeof kind !== "string" || !(PROMOTE_KINDS as readonly string[]).includes(kind)) return bad("invalid_kind");
  if (typeof sourceId !== "string" || !SOURCE_ID.test(sourceId)) return bad("invalid_source_id");
  if (!isObj(item)) return bad("invalid_item");
  if (item.isTest === true) return { ok: false, status: 422, error: "test_item" };
  if (typeof item.title !== "string" || !item.title.trim()) return bad("invalid_title");
  const title = item.title.trim();

  if (kind === "task") {
    if (title.length > 300) return bad("invalid_title");
    const notes = item.notes === undefined ? "" : item.notes;
    if (typeof notes !== "string" || notes.length > MAX_NOTES) return bad("invalid_notes");
    const dates: Record<"dueDate" | "expiresAt", string | null> = { dueDate: null, expiresAt: null };
    for (const k of ["dueDate", "expiresAt"] as const) {
      const v = item[k];
      if (v === undefined || v === null || v === "") continue;
      if (typeof v !== "string" || !isISODate(v)) return bad(`invalid_${k}`);
      dates[k] = v;
    }
    if (item.completed !== undefined && typeof item.completed !== "boolean") return bad("invalid_completed");
    const categoryName = optStr(item.categoryName, 80);
    const assigneeEmail = optStr(item.assigneeEmail, 254);
    if (categoryName === undefined) return bad("invalid_categoryName");
    if (assigneeEmail === undefined) return bad("invalid_assigneeEmail");
    const phi = phiKinds(title, notes);
    if (phi.length) return { ok: false, status: 422, error: "phi_blocked", kinds: phi };
    return { ok: true, value: { kind: "task", sourceId, item: { title, notes, ...dates, completed: item.completed === true, categoryName, assigneeEmail: assigneeEmail?.toLowerCase() ?? null } } };
  }

  if (title.length > MAX_TITLE) return bad("invalid_title");
  const fkind = item.kind;
  if (typeof fkind !== "string" || !(KINDS as readonly string[]).includes(fkind)) return bad("invalid_feedback_kind");
  const description = item.description === undefined ? "" : item.description;
  if (typeof description !== "string" || description.length > MAX_DESCRIPTION) return bad("invalid_description");
  const authorEmail = optStr(item.authorEmail, 254);
  if (authorEmail === undefined) return bad("invalid_authorEmail");
  const phi = phiKinds(title, description);
  if (phi.length) return { ok: false, status: 422, error: "phi_blocked", kinds: phi };
  return { ok: true, value: { kind: "feedback", sourceId, item: { kind: fkind as FeedbackKind, title, description: description.trim(), authorEmail: authorEmail?.toLowerCase() ?? null } } };
}

/** What staging may send: not a test item, not already promoted, and for tasks not recurring or mirrored from the Todo App. */
export function whyNotPromotable(kind: PromoteKind, row: { isTest: boolean; promotedAt: Date | null; recurringId?: string | null; externalSource?: string | null }): string | null {
  if (row.isTest) return "test_item";
  if (row.promotedAt) return "already_promoted";
  if (kind === "task" && row.recurringId) return "recurring";
  if (kind === "task" && row.externalSource) return "synced";
  return null;
}

/** The target must be https (http only for localhost, so local testing works). Returns the origin or null. */
export function validTarget(url: string | undefined): string | null {
  if (!url) return null;
  try {
    const u = new URL(url);
    const local = ["localhost", "127.0.0.1", "[::1]"].includes(u.hostname);
    if (u.protocol !== "https:" && !(local && u.protocol === "http:")) return null;
    return u.origin;
  } catch {
    return null;
  }
}
