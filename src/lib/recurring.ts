import { db } from "./db";
import { todayISO } from "./dates";
import { latestOccurrence } from "./recurrence";

export const RECURRING_CATEGORY = "Recurring tasks";

/**
 * Creates the task instance for each active recurring task that has come due, in the assignee's
 * queue (due on the occurrence date, so it lands in Today and later Past due). Safe to call often:
 * each occurrence is created once (guarded by lastOccurrence and a unique key). Only the most recent
 * occurrence is created, so a long absence does not flood the queue.
 */
export async function ensureRecurringTasks(today = todayISO()): Promise<number> {
  const recurring = await db.recurringTask.findMany({ where: { active: true } });
  const due = recurring
    .map((r) => ({ r, occ: latestOccurrence(r, today) }))
    .filter((x): x is { r: (typeof recurring)[number]; occ: string } => x.occ !== null && x.occ !== x.r.lastOccurrence);
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
