import { db } from "@/lib/db";
import { requireAccess } from "@/lib/session";
import { canAccess } from "@/lib/access";
import { todayISO } from "@/lib/dates";
import { toTaskDTO } from "@/lib/taskTypes";
import { ensureRecurringTasks } from "@/lib/recurring";
import { canEditBoard, pickEmployee, viewableEmployeeIds } from "@/lib/taskAccess";
import { TaskBoard } from "@/components/TaskBoard";

export const dynamic = "force-dynamic";

const UNASSIGNED = "none";

export default async function TasksPage({ searchParams }: { searchParams: { emp?: string } }) {
  const user = await requireAccess("tasks", "view");
  const moduleEdit = canAccess(user, "tasks", "edit");
  const isAdmin = user.role === "ADMIN";

  await ensureRecurringTasks();
  const [categories, employees, me, grants] = await Promise.all([
    db.category.findMany({ orderBy: [{ sortOrder: "asc" }, { name: "asc" }] }),
    db.employee.findMany({ where: { active: true }, orderBy: { name: "asc" } }),
    db.employee.findUnique({ where: { email: user.email } }),
    isAdmin ? Promise.resolve([]) : db.taskViewer.findMany({ where: { userId: user.id }, select: { employeeId: true } }),
  ]);

  // TSK-6: a non-admin only ever gets their own list and the lists the Admin granted them (read-only),
  // whatever the URL says. TSK-7: the Admin gets every employee's list, plus Unassigned.
  const allowed = viewableEmployeeIds({
    isAdmin,
    meId: me?.id ?? null,
    grantedIds: grants.map((g) => g.employeeId),
    allIds: employees.map((e) => e.id),
  });
  const wanted = searchParams.emp;
  const selected: string | null = isAdmin && wanted === UNASSIGNED ? null : pickEmployee(wanted, allowed, me?.id ?? null);

  const noProfile = !isAdmin && !me;
  const canEdit = canEditBoard({ isAdmin, moduleEdit, meId: me?.id ?? null, selected });
  const tasks = noProfile
    ? []
    : await db.task.findMany({
        where: { assigneeId: selected },
        include: { links: true },
        orderBy: [{ sortOrder: "asc" }, { createdAt: "asc" }],
      });
  const viewingOther = !isAdmin && selected !== null && selected !== me?.id;
  const owner = employees.find((e) => e.id === selected);

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
          {viewingOther && (
            <div className="notice" role="status">
              You&apos;re viewing {owner?.name ?? "someone else"}&apos;s tasks. You can look but not change them.
            </div>
          )}
          <TaskBoard
            key={selected ?? UNASSIGNED}
            initialTasks={tasks.map(toTaskDTO)}
            categories={categories.map((c) => ({ id: c.id, name: c.name }))}
            employees={employees.map((e) => ({ id: e.id, name: e.name }))}
            canEdit={canEdit}
            boardAssigneeId={selected}
            today={todayISO()}
            canReorder={isAdmin}
          />
        </>
      )}
    </>
  );
}
