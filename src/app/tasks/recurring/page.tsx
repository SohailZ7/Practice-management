import { db } from "@/lib/db";
import { requireAccess } from "@/lib/session";
import { todayISO } from "@/lib/dates";
import { RecurringManager } from "@/components/RecurringManager";

export const dynamic = "force-dynamic";

export default async function RecurringPage() {
  const user = await requireAccess("tasks", "view");
  const isAdmin = user.role === "ADMIN";
  const [employees, me] = await Promise.all([
    db.employee.findMany({ where: { active: true }, orderBy: { name: "asc" }, select: { id: true, name: true } }),
    db.employee.findUnique({ where: { email: user.email }, select: { id: true } }),
  ]);
  // Non-admins only ever see recurring tasks assigned to them.
  const rows = await db.recurringTask.findMany({
    where: isAdmin ? {} : { assigneeId: me?.id ?? "none" },
    orderBy: [{ active: "desc" }, { createdAt: "asc" }],
  });

  return (
    <RecurringManager
      initial={rows.map((r) => ({
        id: r.id,
        title: r.title,
        assigneeId: r.assigneeId,
        frequency: r.frequency,
        weekday: r.weekday,
        dayOfMonth: r.dayOfMonth,
        startDate: r.startDate,
        endDate: r.endDate,
        active: r.active,
      }))}
      employees={isAdmin ? employees : employees.filter((e) => e.id === me?.id)}
      isAdmin={isAdmin}
      defaultAssigneeId={me?.id ?? null}
      today={todayISO()}
    />
  );
}
