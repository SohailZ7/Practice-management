import { db } from "@/lib/db";
import { requireAccess } from "@/lib/session";
import { canAccess } from "@/lib/access";
import { PRACTICE_TIMEZONE, todayISO } from "@/lib/dates";
import { toTaskDTO } from "@/lib/taskTypes";
import { ensureRecurringTasks } from "@/lib/recurring";
import { canEditBoard, pickEmployee } from "@/lib/taskAccess";
import { loadTaskScope } from "@/lib/taskScope";
import { lastSyncAt, TODO_SYNC_CATEGORY } from "@/lib/todoSyncService";
import { TaskBoard } from "@/components/TaskBoard";

export const dynamic = "force-dynamic";

const UNASSIGNED = "none";

export default async function TasksPage({ searchParams }: { searchParams: { emp?: string } }) {
  const user = await requireAccess("tasks", "view");
  const moduleEdit = canAccess(user, "tasks", "edit");
  const isAdmin = user.role === "ADMIN";

  await ensureRecurringTasks();
  const categories = await db.category.findMany({ orderBy: [{ sortOrder: "asc" }, { name: "asc" }] });

  // TSK-6 / TSK-59: a non-admin only ever gets their own list and the lists the Admin granted them (read-only or
  // editable per grant), whatever the URL says. TSK-7: the Admin gets every list, plus Unassigned.
  const { tabs: employees, me, webViewIds: allowed, editIds } = await loadTaskScope(user);
  const wanted = searchParams.emp;
  const selected: string | null = isAdmin && wanted === UNASSIGNED ? null : pickEmployee(wanted, allowed, me?.id ?? null);

  const noProfile = !isAdmin && !me;
  const canEdit = canEditBoard({ isAdmin, moduleEdit, meId: me?.id ?? null, selected, editableIds: editIds });
  const tasks = noProfile
    ? []
    : await db.task.findMany({
        where: { assigneeId: selected },
        include: { links: true },
        orderBy: [{ sortOrder: "asc" }, { createdAt: "asc" }],
      });
  const grouped = noProfile
    ? []
    : await db.task.groupBy({
        by: ["assigneeId"],
        where: { completed: false, OR: [{ expiresAt: null }, { expiresAt: { gte: todayISO() } }], assigneeId: { in: employees.filter((e) => allowed.includes(e.id)).map((e) => e.id) } },
        _count: { _all: true },
      });
  const openBy = new Map(grouped.map((g) => [g.assigneeId, g._count._all]));
  const workload = employees
    .filter((e) => allowed.includes(e.id))
    .map((e) => ({ id: e.id, name: e.name, open: openBy.get(e.id) ?? 0 }))
    .sort((a, b) => b.open - a.open || a.name.localeCompare(b.name));
  const viewingOther = !isAdmin && selected !== null && selected !== me?.id;
  const readOnlyOther = viewingOther && !canEdit;
  const owner = employees.find((e) => e.id === selected);
  // The sync button appears for the Admin on their own list.
  const showSync = isAdmin && selected !== null && selected === me?.id;
  const lastSync = showSync ? await lastSyncAt() : null;

  return (
    <>
      {noProfile ? (
        <div className="card">
          <p>
            Your login ({user.email}) is not linked to an employee record yet, so there are no tasks to show.
            Ask the administrator to add you under Employees.
          </p>
        </div>
      ) : (
        <>
          {readOnlyOther && (
            <div className="notice" role="status">
              You&apos;re viewing {owner?.name ?? "someone else"}&apos;s tasks. You can look but not change them.
            </div>
          )}
          <TaskBoard
            // A sync changes tasks on the server; remounting on its timestamp makes the board pick them up (it only reads
            // its props on mount, so a plain refresh left stale tasks on screen).
            key={`${selected ?? UNASSIGNED}-${lastSync?.getTime() ?? 0}`}
            initialTasks={tasks.map(toTaskDTO)}
            categories={categories.map((c) => ({ id: c.id, name: c.name }))}
            employees={employees.map((e) => ({ id: e.id, name: e.name }))}
            canEdit={canEdit}
            access={{ isAdmin, moduleEdit, meId: me?.id ?? null, editIds }}
            canUnassign={isAdmin}
            boardAssigneeId={selected}
            today={todayISO()}
            tz={PRACTICE_TIMEZONE}
            workload={workload}
            canReorder={isAdmin}
            sync={showSync ? { category: TODO_SYNC_CATEGORY, lastSyncedAt: lastSync ? lastSync.toISOString() : null } : undefined}
          />
        </>
      )}
    </>
  );
}
