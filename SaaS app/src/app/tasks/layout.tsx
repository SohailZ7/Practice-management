import type { ReactNode } from "react";
import { db } from "@/lib/db";
import { requireAccess } from "@/lib/session";
import { ensureRecurringTasks } from "@/lib/recurring";
import { todayISO } from "@/lib/dates";
import { loadTaskScope } from "@/lib/taskScope";
import { EmployeeTabs, type TabDef } from "@/components/EmployeeTabs";
import { TaskSwitch } from "@/components/TaskSwitch";

export const dynamic = "force-dynamic";

const UNASSIGNED = "none";

export default async function TasksLayout({ children }: { children: ReactNode }) {
  const user = await requireAccess("tasks", "view");
  const isAdmin = user.role === "ADMIN";
  await ensureRecurringTasks();

  const { tabs: employees, me, viewIds: allowed } = await loadTaskScope(user);

  // Someone who can only see their own list gets a simple My tasks | Recurring switch.
  if (!isAdmin && allowed.length <= 1) {
    return (
      <>
        <h1>My tasks</h1>
        <TaskSwitch />
        {children}
      </>
    );
  }

  const grouped = await db.task.groupBy({
    by: ["assigneeId"],
    where: {
      completed: false,
      OR: [{ expiresAt: null }, { expiresAt: { gte: todayISO() } }],
      ...(isAdmin ? {} : { assigneeId: { in: allowed } }),
    },
    _count: { _all: true },
  });
  const open = new Map(grouped.map((g) => [g.assigneeId, g._count._all]));

  // Own tab first, then everyone else A to Z; the Admin also gets Unassigned. Recurring is last.
  const people = employees
    .filter((e) => allowed.includes(e.id))
    .sort((a, b) => (a.id === me?.id ? -1 : b.id === me?.id ? 1 : a.name.localeCompare(b.name)));
  const tabs: TabDef[] = [
    ...people.map((e) => ({ id: e.id, label: e.name, count: open.get(e.id) ?? 0, href: `/tasks?emp=${e.id}` })),
    ...(isAdmin ? [{ id: UNASSIGNED, label: "Unassigned", count: open.get(null) ?? 0, href: `/tasks?emp=${UNASSIGNED}` }] : []),
    { id: "recurring", label: "↻ Recurring", count: null, href: "/tasks/recurring" },
    { id: "analytics", label: "Analytics", count: null, href: "/tasks/analytics" },
  ];

  return (
    <>
      <h1>{isAdmin ? "Tasks" : "Tasks"}</h1>
      <EmployeeTabs tabs={tabs} defaultId={me?.id ?? people[0]?.id ?? UNASSIGNED} draggable={isAdmin} />
      {children}
    </>
  );
}
