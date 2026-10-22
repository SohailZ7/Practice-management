import { db } from "@/lib/db";
import { requireAccess } from "@/lib/session";
import { parseWindow } from "@/lib/analytics";
import { loadTaskScope } from "@/lib/taskScope";
import { audit } from "@/lib/audit";
import { TaskMovesLog } from "@/components/TaskMovesLog";
import { loadTeamAnalytics } from "@/lib/teamAnalyticsService";
import { TeamAnalytics } from "@/components/TeamAnalytics";

export const dynamic = "force-dynamic";

export default async function TaskAnalyticsPage({ searchParams }: { searchParams: { days?: string } }) {
  const user = await requireAccess("tasks", "view");
  const isAdmin = user.role === "ADMIN";
  const scope = await loadTaskScope(user);
  // The Admin gets every employee (deactivated ones too, while they still have completions) plus Unassigned.
  // Everyone else gets themselves and the tabs granted to them: the same rule as the task boards (TSK-6, TSK-59).
  const scopeIds = isAdmin ? (await db.employee.findMany({ select: { id: true } })).map((e) => e.id) : scope.viewIds;
  const days = parseWindow(searchParams.days);

  const { team, byCategory, categories } = await loadTeamAnalytics({
    scopeIds,
    includeUnassigned: isAdmin,
    periodDays: days,
  });

  // TSK-62: the Admin sees every move of a task between employees in the window.
  const moves = isAdmin
    ? await db.taskMove.findMany({
        where: { createdAt: { gte: new Date(Date.now() - days * 86_400_000) } },
        orderBy: { createdAt: "desc" },
        take: 300,
      })
    : [];
  const titles = new Map(
    (await db.task.findMany({ where: { id: { in: moves.map((m) => m.taskId) } }, select: { id: true, title: true } })).map((t) => [t.id, t.title]),
  );
  if (isAdmin) await audit(user.email, "taskmoves.view", `${moves.length} move(s), last ${days} days`);

  return (
    <>
      {!isAdmin && scopeIds.length === 0 ? (
        <div className="card">
          <p>Your login ({user.email}) is not linked to an employee record yet, so there is no velocity to show. Ask the administrator to add you under Employees.</p>
        </div>
      ) : (
        <TeamAnalytics team={team} byCategory={byCategory} categories={categories} />
      )}
      {isAdmin && (
        <TaskMovesLog
          days={days}
          rows={moves.map((m) => ({
            id: m.id,
            when: m.createdAt.toISOString(),
            title: titles.get(m.taskId) ?? null,
            from: m.fromName,
            to: m.toName,
            by: m.movedBy,
            kind: m.kind,
          }))}
        />
      )}
    </>
  );
}
