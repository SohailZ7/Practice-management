import type { ReactNode } from "react";
import { db } from "@/lib/db";
import { requireAccess } from "@/lib/session";
import { ensureRecurringTasks } from "@/lib/recurring";
import { todayISO } from "@/lib/dates";
import { EmployeeTabs, type TabDef } from "@/components/EmployeeTabs";
import { TaskSwitch } from "@/components/TaskSwitch";

export const dynamic = "force-dynamic";

const UNASSIGNED = "none";

export default async function TasksLayout({ children }: { children: ReactNode }) {
  const user = await requireAccess("tasks", "view");
  const isAdmin = user.role === "ADMIN";
  await ensureRecurringTasks();

  if (!isAdmin) {
    return (
      <>
        <h1>My tasks</h1>
        <TaskSwitch />
        {children}
      </>
    );
  }

  const [employees, me, grouped] = await Promise.all([
    db.employee.findMany({ where: { active: true }, orderBy: { name: "asc" } }),
    db.employee.findUnique({ where: { email: user.email } }),
    db.task.groupBy({ by: ["assigneeId"], where: { completed: false, OR: [{ expiresAt: null }, { expiresAt: { gte: todayISO() } }] }, _count: { _all: true } }),
  ]);
  const open = new Map(grouped.map((g) => [g.assigneeId, g._count._all]));

  // The admin's own tab comes first, then everyone else A to Z, then Unassigned and Recurring.
  const ordered = [...employees].sort((a, b) => (a.id === me?.id ? -1 : b.id === me?.id ? 1 : a.name.localeCompare(b.name)));
  const tabs: TabDef[] = [
    ...ordered.map((e) => ({ id: e.id, label: e.name, count: open.get(e.id) ?? 0, href: `/tasks?emp=${e.id}` })),
    { id: UNASSIGNED, label: "Unassigned", count: open.get(null) ?? 0, href: `/tasks?emp=${UNASSIGNED}` },
    { id: "recurring", label: "↻ Recurring", count: null, href: "/tasks/recurring" },
  ];

  return (
    <>
      <h1>Tasks</h1>
      <EmployeeTabs tabs={tabs} defaultId={me?.id ?? ordered[0]?.id ?? UNASSIGNED} />
      {children}
    </>
  );
}
