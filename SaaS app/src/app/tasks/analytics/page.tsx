import { db } from "@/lib/db";
import { requireAccess } from "@/lib/session";
import { parseWindow } from "@/lib/analytics";
import { viewableEmployeeIds } from "@/lib/taskAccess";
import { loadTeamAnalytics } from "@/lib/teamAnalyticsService";
import { TeamAnalytics } from "@/components/TeamAnalytics";

export const dynamic = "force-dynamic";

export default async function TaskAnalyticsPage({ searchParams }: { searchParams: { days?: string } }) {
  const user = await requireAccess("tasks", "view");
  const isAdmin = user.role === "ADMIN";
  const [employees, me, grants] = await Promise.all([
    db.employee.findMany({ select: { id: true, active: true } }),
    db.employee.findUnique({ where: { email: user.email }, select: { id: true } }),
    isAdmin ? Promise.resolve([]) : db.taskViewer.findMany({ where: { userId: user.id }, select: { employeeId: true } }),
  ]);
  // The Admin gets every employee (deactivated ones too, while they still have completions) plus Unassigned.
  // Everyone else gets themselves and the employees granted to them: the same rule as the task boards (TSK-6).
  const scopeIds = isAdmin
    ? employees.map((e) => e.id)
    : viewableEmployeeIds({
        isAdmin: false,
        meId: me?.id ?? null,
        grantedIds: grants.map((g) => g.employeeId),
        allIds: employees.filter((e) => e.active).map((e) => e.id),
      });

  const { team, byCategory, categories } = await loadTeamAnalytics({
    scopeIds,
    includeUnassigned: isAdmin,
    periodDays: parseWindow(searchParams.days),
  });

  return (
    <>
      {!isAdmin && scopeIds.length === 0 ? (
        <div className="card">
          <p>Your login ({user.email}) is not linked to an employee record yet, so there is no velocity to show. Ask the administrator to add you under Employees.</p>
        </div>
      ) : (
        <TeamAnalytics team={team} byCategory={byCategory} categories={categories} />
      )}
    </>
  );
}
