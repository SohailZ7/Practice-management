import { db } from "./db";
import { todayISO } from "./dates";
import { addDays } from "./dates";
import { latestOccurrence, planReconcile } from "./recurrence";

export const RECURRING_CATEGORY = "Recurring tasks";

/**
 * Creates the task instance for each active recurring task that has come due, in the assignee's
 * queue (due on the occurrence date, so it lands in Today and later Past due).  A recurring task shows up in the
 * assignee's queue on its specific day, not before. Safe to call often:
 * each occurrence is created once (guarded by lastOccurrence and a unique key). Only the most recent
 * occurrence is created, so a long absence does not flood the queue. `onlyIds` limits it to some
 * recurring tasks (used by the verification script so it never touches real ones).
 */
export async function ensureRecurringTasks(today = todayISO(), onlyIds?: string[]): Promise<number> {
  const recurring = await db.recurringTask.findMany({ where: { active: true, ...(onlyIds ? { id: { in: onlyIds } } : {}) } });
  const due = recurring
    .map((r) => ({ r, occ: latestOccurrence(r, today) }))
    .filter((x): x is { r: (typeof recurring)[number]; occ: string } => x.occ !== null && x.occ > (x.r.lastOccurrence ?? ""));
  if (due.length === 0) return 0;

  const category = await db.category.upsert({
    where: { name: RECURRING_CATEGORY },
    update: {},
    create: { name: RECURRING_CATEGORY, sortOrder: 99 },
  });
  const top = await db.task.aggregate({ _max: { sortOrder: true } });
  let order = (top._max.sortOrder ?? 0) + 1;

  let created = 0;
  for (const { r, occ } of due) {
    try {
      await db.$transaction([
        db.task.create({
          data: {
            title: r.title,
            assigneeId: r.assigneeId,
            categoryId: category.id,
            dueDate: occ,
            sortOrder: order++,
            recurringId: r.id,
            occurrenceDate: occ,
          },
        }),
        db.recurringTask.update({ where: { id: r.id }, data: { lastOccurrence: occ } }),
      ]);
      created++;
    } catch (e) {
      // A concurrent request already created this occurrence (unique key): fine.
      if (!(e as { code?: string }).code?.startsWith("P20")) throw e;
      await db.recurringTask.update({ where: { id: r.id }, data: { lastOccurrence: occ } }).catch(() => undefined);
    }
  }
  return created;
}

/**
 * Call after a recurring task is created or edited. Removes open generated tasks the rule no longer
 * produces, keeps the open ones in step with the assignee and title, and resets where generation
 * resumes, so the queue always matches the rule. See planReconcile for the rules.
 */
export async function reconcileRecurring(id: string, previousTitle?: string, today = todayISO()): Promise<void> {
  const rec = await db.recurringTask.findUnique({ where: { id } });
  if (!rec) return;
  const instances = await db.task.findMany({
    where: { recurringId: id },
    select: { id: true, occurrenceDate: true, completed: true, title: true, assigneeId: true },
  });
  const plan = planReconcile(
    rec,
    instances.map((i) => ({ id: i.id, occurrenceDate: i.occurrenceDate ?? "", completed: i.completed })),
    today,
  );
  const gone = new Set(plan.deleteIds);
  const keptOpen = instances.filter((i) => !i.completed && !gone.has(i.id));

  await db.$transaction([
    db.task.deleteMany({ where: { id: { in: plan.deleteIds } } }),
    // Open tasks follow the assignee; a task whose title was not changed by hand follows the new title.
    db.task.updateMany({
      where: { id: { in: keptOpen.filter((i) => i.assigneeId !== rec.assigneeId).map((i) => i.id) } },
      data: { assigneeId: rec.assigneeId },
    }),
    db.task.updateMany({
      where: {
        id: { in: keptOpen.filter((i) => i.title === (previousTitle ?? rec.title) && i.title !== rec.title).map((i) => i.id) },
      },
      data: { title: rec.title },
    }),
    db.recurringTask.update({ where: { id }, data: { lastOccurrence: plan.lastOccurrence } }),
  ]);
}
