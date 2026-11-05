// Database side of Feedback, shared by the web page and the desktop API. Audit details hold ids and the category only;
// the text of a feedback item (which may have been dictated) is never written to the audit log or any log.
import { db } from "../db";
import { audit } from "../audit";
import { canEditFeedback, checkFeedback, toFeedbackOut, type FeedbackOut, type FeedbackPatch } from "./rules";
import type { PhiKind } from "../phiGuard";

export class FeedbackError extends Error {
  constructor(public status: number, public code: string, public phi?: PhiKind[]) {
    super(code);
  }
}

const withAuthor = { author: { select: { name: true } } } as const;

export async function listFeedback(viewerId: string, limit = 100): Promise<FeedbackOut[]> {
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
