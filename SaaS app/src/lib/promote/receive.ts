// Production side of "Promote to production": creates the task or feedback item once per (kind, sourceId).
// Audit entries hold ids and the kind only, never the text.
import { db } from "../db";
import { audit } from "../audit";
import type { Parsed } from "./rules";

export const ACTOR = "promote-service";

export type ReceiveResult = { status: "created" | "exists"; targetId: string };

const isUniqueViolation = (e: unknown) => !!e && typeof e === "object" && (e as { code?: string }).code === "P2002";

export async function receivePromotion(p: Parsed): Promise<ReceiveResult> {
  const found = await db.promotedItem.findUnique({ where: { kind_sourceId: { kind: p.kind, sourceId: p.sourceId } } });
  if (found) {
    await audit(ACTOR, "promote.duplicate", `${p.kind} source ${p.sourceId} -> ${found.targetId}`);
    return { status: "exists", targetId: found.targetId };
  }
  try {
    const targetId = await db.$transaction(async (tx) => {
      const id = p.kind === "task" ? await createTask(tx as unknown as typeof db, p.item) : await createFeedback(tx as unknown as typeof db, p.item);
      await tx.promotedItem.create({ data: { kind: p.kind, sourceId: p.sourceId, targetId: id } });
      return id;
    });
    await audit(ACTOR, "promote.receive", `${p.kind} source ${p.sourceId} -> ${targetId}`);
    return { status: "created", targetId };
  } catch (e) {
    // A concurrent retry won the race; the transaction rolled back, so return what it created.
    if (isUniqueViolation(e)) {
      const again = await db.promotedItem.findUnique({ where: { kind_sourceId: { kind: p.kind, sourceId: p.sourceId } } });
      if (again) return { status: "exists", targetId: again.targetId };
    }
    throw e;
  }
}

async function createTask(tx: typeof db, t: Extract<Parsed, { kind: "task" }>["item"]): Promise<string> {
  const assignee = t.assigneeEmail ? await tx.employee.findUnique({ where: { email: t.assigneeEmail } }) : null;
  let categoryId: string | null = null;
  if (t.categoryName) {
    const cat = (await tx.category.findUnique({ where: { name: t.categoryName } })) ?? (await tx.category.create({ data: { name: t.categoryName } }));
    categoryId = cat.id;
  }
  const top = await tx.task.aggregate({ _max: { sortOrder: true } });
  const row = await tx.task.create({
    data: {
      title: t.title,
      notes: t.notes,
      dueDate: t.dueDate,
      expiresAt: t.expiresAt,
      completed: t.completed,
      completedAt: t.completed ? new Date() : null,
      categoryId,
      assigneeId: assignee?.active === false ? null : (assignee?.id ?? null),
      sortOrder: (top._max.sortOrder ?? 0) + 1,
    },
  });
  return row.id;
}

async function createFeedback(tx: typeof db, f: Extract<Parsed, { kind: "feedback" }>["item"]): Promise<string> {
  // The author is matched by email; otherwise the first active admin owns it (FeedbackItem needs an author).
  let author = f.authorEmail ? await tx.user.findUnique({ where: { email: f.authorEmail } }) : null;
  if (!author?.active) author = await tx.user.findFirst({ where: { role: "ADMIN", active: true }, orderBy: { createdAt: "asc" } });
  if (!author) throw new Error("no author available");
  const row = await tx.feedbackItem.create({ data: { kind: f.kind, title: f.title, description: f.description, authorId: author.id, source: "promoted" } });
  return row.id;
}
