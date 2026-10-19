"use server";

import { revalidatePath } from "next/cache";
import { db } from "@/lib/db";
import { audit } from "@/lib/audit";
import { requireAccess, type CurrentUser } from "@/lib/session";
import { isISODate } from "@/lib/dates";
import { phiCheck } from "@/lib/phiCheck";
import type { PhiBlock } from "@/lib/phiGuard";
import { ruleError } from "@/lib/recurrence";
import { ensureRecurringTasks, reconcileRecurring } from "@/lib/recurring";
import type { RecurringDTO, RecurringInput, RecurringPatch } from "@/lib/taskTypes";

// Same visibility rule as tasks (TSK-6): non-admins only create and change their own.

const isAdmin = (u: CurrentUser) => u.role === "ADMIN";

const toDTO = (r: {
  id: string;
  title: string;
  assigneeId: string | null;
  frequency: string;
  weekday: number | null;
  dayOfMonth: number | null;
  startDate: string;
  endDate: string | null;
  active: boolean;
}): RecurringDTO => ({
  id: r.id,
  title: r.title,
  assigneeId: r.assigneeId,
  frequency: r.frequency,
  weekday: r.weekday,
  dayOfMonth: r.dayOfMonth,
  startDate: r.startDate,
  endDate: r.endDate,
  active: r.active,
});

async function myEmployeeId(user: CurrentUser) {
  return (await db.employee.findUnique({ where: { email: user.email }, select: { id: true } }))?.id ?? null;
}

async function loadMine(user: CurrentUser, id: string) {
  const r = await db.recurringTask.findUnique({ where: { id }, include: { assignee: true } });
  if (!r) throw new Error("Recurring task not found");
  if (!isAdmin(user) && r.assignee?.email !== user.email) throw new Error("That recurring task is not assigned to you");
  return r;
}

function normalize(input: { frequency: string; weekday: number | null; dayOfMonth: number | null }) {
  // Keep only the field that matters for the frequency.
  return {
    weekday: input.frequency === "WEEKLY" ? input.weekday : null,
    dayOfMonth: input.frequency === "MONTHLY" ? input.dayOfMonth : null,
  };
}

export async function createRecurring(input: RecurringInput, confirmNoPhi = false): Promise<RecurringDTO | PhiBlock> {
  const user = await requireAccess("tasks", "edit");
  const title = (input.title ?? "").trim().slice(0, 300);
  if (!title) throw new Error("Enter a title");
  const blocked = await phiCheck(user, null, [title], confirmNoPhi === true, "recurring");
  if (blocked) return blocked;
  if (!isISODate(input.startDate)) throw new Error("Enter a real start date");
  if (input.endDate && !isISODate(input.endDate)) throw new Error("Enter a real end date");
  const assigneeId = isAdmin(user) ? input.assigneeId || null : await myEmployeeId(user);
  if (assigneeId && !(await db.employee.findUnique({ where: { id: assigneeId } }))) throw new Error("Employee not found");
  const rule = { ...input, ...normalize(input), endDate: input.endDate || null };
  const error = ruleError(rule);
  if (error) throw new Error(error);

  const row = await db.recurringTask.create({
    data: {
      title,
      assigneeId,
      frequency: rule.frequency,
      weekday: rule.weekday,
      dayOfMonth: rule.dayOfMonth,
      startDate: rule.startDate,
      endDate: rule.endDate,
      createdById: user.id,
    },
  });
  await audit(user.email, "recurring.add", `${row.id}: ${row.frequency}`);
  await reconcileRecurring(row.id); // sets where generation starts: its specific day, not earlier
  await ensureRecurringTasks(); // if today is one of its days, the task appears right away // if it is already due, the first task appears right away
  revalidatePath("/tasks", "layout");
  return toDTO(row);
}

export async function updateRecurring(id: string, patch: RecurringPatch, confirmNoPhi = false): Promise<RecurringDTO | PhiBlock> {
  const user = await requireAccess("tasks", "edit");
  const existing = await loadMine(user, id);
  if (patch.title !== undefined && patch.title.trim() !== existing.title) {
    const blocked = await phiCheck(user, id, [patch.title.trim().slice(0, 300)], confirmNoPhi === true, "recurring");
    if (blocked) return blocked;
  }
  const merged = {
    title: patch.title !== undefined ? patch.title.trim().slice(0, 300) : existing.title,
    frequency: patch.frequency ?? existing.frequency,
    weekday: patch.weekday !== undefined ? patch.weekday : existing.weekday,
    dayOfMonth: patch.dayOfMonth !== undefined ? patch.dayOfMonth : existing.dayOfMonth,
    startDate: patch.startDate ?? existing.startDate,
    endDate: patch.endDate !== undefined ? patch.endDate || null : existing.endDate,
    active: patch.active ?? existing.active,
  };
  if (!merged.title) throw new Error("A title can't be blank");
  if (!isISODate(merged.startDate)) throw new Error("Enter a real start date");
  if (merged.endDate && !isISODate(merged.endDate)) throw new Error("Enter a real end date");
  // Defaults when switching frequency so the rule stays valid.
  if (merged.frequency === "WEEKLY" && merged.weekday === null) merged.weekday = 0;
  if (merged.frequency === "MONTHLY" && merged.dayOfMonth === null) merged.dayOfMonth = 1;
  const n = normalize(merged);
  const error = ruleError({ ...merged, ...n });
  if (error) throw new Error(error);

  let assigneeId = existing.assigneeId;
  if (patch.assigneeId !== undefined) {
    if (!isAdmin(user)) throw new Error("Only the administrator can reassign a recurring task");
    if (patch.assigneeId && !(await db.employee.findUnique({ where: { id: patch.assigneeId } }))) throw new Error("Employee not found");
    assigneeId = patch.assigneeId || null;
  }

  const row = await db.recurringTask.update({
    where: { id },
    data: { ...merged, ...n, assigneeId },
  });
  await audit(user.email, "recurring.edit", `${id}: ${Object.keys(patch).join(",")}`);
  await reconcileRecurring(id, existing.title); // drop tasks the new rule no longer produces
  await ensureRecurringTasks();
  revalidatePath("/tasks", "layout");
  return toDTO(row);
}

/** Stops the repeat. Tasks it already created stay where they are. */
export async function deleteRecurring(id: string): Promise<void> {
  const user = await requireAccess("tasks", "edit");
  await loadMine(user, id);
  await db.recurringTask.delete({ where: { id } });
  await audit(user.email, "recurring.delete", id);
  revalidatePath("/tasks", "layout");
}
