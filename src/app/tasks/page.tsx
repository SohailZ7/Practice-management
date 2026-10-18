import Link from "next/link";
import { db } from "@/lib/db";
import { requireAccess } from "@/lib/session";
import { canAccess } from "@/lib/access";
import { todayISO } from "@/lib/dates";
import { toTaskDTO } from "@/lib/taskTypes";
import { TaskBoard } from "@/components/TaskBoard";

export const dynamic = "force-dynamic";

const UNASSIGNED = "none";

export default async function TasksPage({ searchParams }: { searchParams: { emp?: string } }) {
  const user = await requireAccess("tasks", "view");
  const canEdit = canAccess(user, "tasks", "edit");
  const isAdmin = user.role === "ADMIN";

  const [categories, employees, me] = await Promise.all([
    db.category.findMany({ orderBy: [{ sortOrder: "asc" }, { name: "asc" }] }),
    db.employee.findMany({ where: { active: true }, orderBy: { name: "asc" } }),
    db.employee.findUnique({ where: { email: user.email } }),
  ]);

  // TSK-6: non-admins only ever get their own tasks, whatever the URL says.
  // TSK-7: the Admin gets a tab per employee (plus Unassigned).
  let selected: string | null;
  if (isAdmin) {
    const wanted = searchParams.emp;
    if (wanted === UNASSIGNED) selected = null;
    else if (wanted && employees.some((e) => e.id === wanted)) selected = wanted;
    else selected = me?.id ?? employees[0]?.id ?? null;
  } else {
    selected = me?.id ?? null;
  }

  const noProfile = !isAdmin && !me;
  const tasks = noProfile
    ? []
    : await db.task.findMany({
        where: { assigneeId: selected },
        include: { links: true },
        orderBy: [{ sortOrder: "asc" }, { createdAt: "asc" }],
      });

  const openCounts = new Map<string | null, number>();
  if (isAdmin) {
    const grouped = await db.task.groupBy({
      by: ["assigneeId"],
      where: { completed: false },
      _count: { _all: true },
    });
    grouped.forEach((g) => openCounts.set(g.assigneeId, g._count._all));
  }

  return (
    <>
      <h1>{isAdmin ? "Tasks" : "My tasks"}</h1>

      {isAdmin && (
        <div className="tabs" role="tablist" aria-label="Employees">
          {employees.map((e) => (
            <Link
              key={e.id}
              href={`/tasks?emp=${e.id}`}
              role="tab"
              aria-selected={selected === e.id}
              className={selected === e.id ? "tab on" : "tab"}
            >
              {e.name}
              <span className="count">{openCounts.get(e.id) ?? 0}</span>
            </Link>
          ))}
          <Link
            href={`/tasks?emp=${UNASSIGNED}`}
            role="tab"
            aria-selected={selected === null}
            className={selected === null ? "tab on" : "tab"}
          >
            Unassigned
            <span className="count">{openCounts.get(null) ?? 0}</span>
          </Link>
        </div>
      )}

      {noProfile ? (
        <div className="card">
          <p>
            Your login ({user.email}) is not linked to an employee record yet, so there are no tasks to show.
            Ask the administrator to add you under Employees.
          </p>
        </div>
      ) : (
        <TaskBoard
          key={selected ?? UNASSIGNED}
          initialTasks={tasks.map(toTaskDTO)}
          categories={categories.map((c) => ({ id: c.id, name: c.name }))}
          employees={employees.map((e) => ({ id: e.id, name: e.name }))}
          canEdit={canEdit}
          boardAssigneeId={selected}
          today={todayISO()}
        />
      )}
    </>
  );
}
