// Database side of Feedback, shared by the web page and the desktop API. Audit details hold ids and the category only;
// the text of a feedback item (which may have been dictated) is never written to the audit log or any log.
import { db } from "../db";
import { audit } from "../audit";
import { canEditFeedback, checkFeedback, toFeedbackOut, type FeedbackOut, type FeedbackPatch } from "./rules";
import type { PhiKind } from "../phiGuard";
import { releaseNumber, runningReleaseNumber, shipDueItems } from "./autoShip";

export class FeedbackError extends Error {
  constructor(public status: number, public code: string, public phi?: PhiKind[]) {
    super(code);
  }
}

const withAuthor = { author: { select: { name: true } } } as const;

export async function listFeedback(viewerId: string, limit = 100): Promise<FeedbackOut[]> {
  await shipDueItems();
  const rows = await db.feedbackItem.findMany({ orderBy: { createdAt: "desc" }, take: Math.min(200, Math.max(1, limit)), include: withAuthor });
  return rows.map((r) => toFeedbackOut(r, viewerId));
}

export async function createFeedback(user: { id: string; email: string }, body: Record<string, unknown>, source: "web" | "desktop"): Promise<FeedbackOut> {
  const c = checkFeedback(body, "create");
  if (!c.ok) throw new FeedbackError(c.phi ? 422 : 400, c.phi ? "possible_phi" : c.error, c.phi);
  const v = c.value;
  const row = await db.feedbackItem.create({
    data: { kind: v.kind!, title: v.title!, description: v.description ?? "", authorId: user.id, source },
    include: withAuthor,
  });
  await audit(user.email, "feedback.add", `${row.id} ${row.kind} via ${source}`);
  return toFeedbackOut(row, user.id);
}

export async function updateFeedback(user: { id: string; email: string }, id: string, body: Record<string, unknown>, source: "web" | "desktop"): Promise<FeedbackOut> {
  const existing = await db.feedbackItem.findUnique({ where: { id } });
  if (!existing) throw new FeedbackError(404, "not_found");
  if (!canEditFeedback(user.id, existing.authorId)) throw new FeedbackError(403, "forbidden");
  const c = checkFeedback(body, "update");
  if (!c.ok) throw new FeedbackError(c.phi ? 422 : 400, c.phi ? "possible_phi" : c.error, c.phi);
  const data: FeedbackPatch = c.value;
  const row = await db.feedbackItem.update({ where: { id }, data, include: withAuthor });
  await audit(user.email, "feedback.edit", `${id} ${row.kind} via ${source}`);
  return toFeedbackOut(row, user.id);
}

// ---- Workflow: status changes, test notes, comments --------------------------------------------------------------
import { checkMove, isScope, isStatus, MAX_COMMENT, MAX_TEST_NOTES, type Actor } from "./workflow";
import { detectPhi } from "../phiGuard";

export type WorkflowActor = Actor & { email: string; name: string };
export type CommentOut = { id: string; authorName: string; authorKind: string; body: string; createdAt: string };
export type EventOut = { id: string; actorName: string; actorKind: string; field: string; from: string | null; to: string | null; at: string };

function textProblem(text: string, max: number): string | null {
  if (text.length > max) return "too_long";
  return detectPhi(text).length ? "possible_phi" : null;
}

const fail = (code: string) => new FeedbackError(code === "possible_phi" ? 422 : code === "not_allowed" || code.startsWith("only_") || code === "agent_move_not_allowed" ? 403 : 400, code);

export async function setFeedbackWorkflow(
  actor: WorkflowActor,
  id: string,
  input: { status?: unknown; scope?: unknown; testNotes?: unknown; comment?: unknown; release?: unknown },
): Promise<FeedbackOut> {
  const item = await db.feedbackItem.findUnique({ where: { id }, include: withAuthor });
  if (!item) throw new FeedbackError(404, "not_found");
  const cur = { status: isStatus(item.status) ? item.status : ("new" as const), scope: isScope(item.scope) ? item.scope : null, testNotes: item.testNotes };
  const data: Record<string, unknown> = {};
  const events: { field: string; from: string | null; to: string | null }[] = [];

  let testNotes: string | undefined;
  if (input.testNotes !== undefined) {
    if (typeof input.testNotes !== "string") throw fail("bad_test_notes");
    if (!actor.isAdmin && actor.kind !== "agent") throw fail("not_allowed");
    const p = textProblem(input.testNotes, MAX_TEST_NOTES);
    if (p) throw fail(p);
    testNotes = input.testNotes.trim();
    if (testNotes !== item.testNotes) { data.testNotes = testNotes; events.push({ field: "test_notes", from: null, to: "updated" }); }
  }
  let scope: typeof cur.scope | undefined;
  if (input.scope !== undefined) {
    if (!isScope(input.scope)) throw fail("bad_scope");
    if (!actor.isAdmin) throw fail("only_owner_can_set_scope");
    scope = input.scope;
    if (scope !== cur.scope) { data.scope = scope; events.push({ field: "scope", from: cur.scope, to: scope }); }
  }
  let comment: string | undefined;
  if (typeof input.comment === "string" && input.comment.trim()) {
    comment = input.comment.trim();
    const p = textProblem(comment, MAX_COMMENT);
    if (p) throw fail(p);
  }
  if (input.release !== undefined) {
    const n = releaseNumber(input.release);
    if (n === null) throw fail("bad_release");
    if (!actor.isAdmin && actor.kind !== "agent") throw fail("not_allowed");
    if (n !== item.shippedRelease) { data.shippedRelease = n; events.push({ field: "release", from: item.shippedRelease === null ? null : String(item.shippedRelease), to: String(n) }); }
  }
  if (input.status !== undefined) {
    if (!isStatus(input.status)) throw fail("bad_status");
    const m = checkMove(actor, cur, input.status, { scope, comment, testNotes });
    if (!m.ok) throw fail(m.error);
    data.status = input.status;
    events.push({ field: "status", from: cur.status, to: input.status });
    // Moving to On staging records the release it was built in: the one given, else the release this build runs (the
    // agent calls this after deploying). Production later marks the item Shipped by comparing that number.
    if (input.status === "on_staging" && input.release === undefined) {
      const n = runningReleaseNumber();
      if (n !== null) data.shippedRelease = n;
    }
    // The owner approving (from any status) is the owner's own approval click, which "other" items need.
    if (input.status === "approved" && actor.isAdmin && actor.kind === "user") data.ownerApprovedAt = new Date();
    if (input.status === "needs_changes" || input.status === "build_it") data.ownerApprovedAt = null;
  }
  if (!Object.keys(data).length && !comment) throw fail("nothing_to_change");

  const row = await db.$transaction(async (tx) => {
    const r = Object.keys(data).length ? await tx.feedbackItem.update({ where: { id }, data, include: withAuthor }) : item;
    for (const e of events) await tx.feedbackEvent.create({ data: { itemId: id, actorName: actor.name, actorKind: actor.kind, field: e.field, fromValue: e.from, toValue: e.to } });
    if (comment) await tx.feedbackComment.create({ data: { itemId: id, authorName: actor.name, authorKind: actor.kind, body: comment } });
    return r;
  });
  // Audit: ids and status words only, never the text.
  await audit(actor.email, "feedback.workflow", `${id} ${events.map((e) => `${e.field}:${e.from ?? "-"}>${e.to ?? "-"}`).join(" ")}${comment ? " +comment" : ""} via ${actor.kind}`.slice(0, 200));
  return toFeedbackOut(row, "");
}

export async function addFeedbackComment(actor: WorkflowActor & { id: string }, itemId: string, body: unknown): Promise<void> {
  const item = await db.feedbackItem.findUnique({ where: { id: itemId } });
  if (!item) throw new FeedbackError(404, "not_found");
  if (!actor.isAdmin && !actor.isApprover && actor.kind !== "agent" && item.authorId !== actor.id) throw fail("not_allowed");
  if (typeof body !== "string" || !body.trim()) throw fail("empty_comment");
  const p = textProblem(body.trim(), MAX_COMMENT);
  if (p) throw fail(p);
  await db.feedbackComment.create({ data: { itemId, authorName: actor.name, authorKind: actor.kind, body: body.trim() } });
  await audit(actor.email, "feedback.comment", `${itemId} via ${actor.kind}`);
}

export async function listComments(itemIds: string[]): Promise<Record<string, CommentOut[]>> {
  const rows = await db.feedbackComment.findMany({ where: { itemId: { in: itemIds } }, orderBy: { createdAt: "asc" } });
  const out: Record<string, CommentOut[]> = {};
  for (const r of rows) (out[r.itemId] ??= []).push({ id: r.id, authorName: r.authorName, authorKind: r.authorKind, body: r.body, createdAt: r.createdAt.toISOString() });
  return out;
}

export async function listEvents(itemIds: string[]): Promise<Record<string, EventOut[]>> {
  const rows = await db.feedbackEvent.findMany({ where: { itemId: { in: itemIds } }, orderBy: { createdAt: "asc" } });
  const out: Record<string, EventOut[]> = {};
  for (const r of rows) (out[r.itemId] ??= []).push({ id: r.id, actorName: r.actorName, actorKind: r.actorKind, field: r.field, from: r.fromValue, to: r.toValue, at: r.createdAt.toISOString() });
  return out;
}

export async function listFeedbackByStatus(viewerId: string, status?: string, limit = 50): Promise<FeedbackOut[]> {
  await shipDueItems();
  const rows = await db.feedbackItem.findMany({ where: isStatus(status) ? { status } : {}, orderBy: { createdAt: "asc" }, take: Math.min(100, Math.max(1, limit)), include: withAuthor });
  return rows.map((r) => toFeedbackOut(r, viewerId));
}

export async function getFeedback(viewerId: string, id: string): Promise<FeedbackOut | null> {
  const r = await db.feedbackItem.findUnique({ where: { id }, include: withAuthor });
  return r ? toFeedbackOut(r, viewerId) : null;
}
