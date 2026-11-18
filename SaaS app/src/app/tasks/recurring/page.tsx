import { db } from "@/lib/db";
import { requireAccess } from "@/lib/session";
import Link from "next/link";
import { addDays, formatShort, isISODate, startOfWeek, todayISO } from "@/lib/dates";
import { isOccurrence, describeRule } from "@/lib/recurrence";
import { RecurringManager } from "@/components/RecurringManager";

export const dynamic = "force-dynamic";

export default async function RecurringPage({ searchParams }: { searchParams: { view?: string; week?: string } }) {
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

  const tabs = (
    <div className="row" style={{ marginBottom: ".75rem" }}>
      <div className="seg" role="tablist" aria-label="Recurring view">
        <Link href="/tasks/recurring" className={searchParams.view === "week" ? "" : "on"} role="tab" aria-selected={searchParams.view !== "week"}>Manage</Link>
        <Link href="/tasks/recurring?view=week" className={searchParams.view === "week" ? "on" : ""} role="tab" aria-selected={searchParams.view === "week"}>One week</Link>
      </div>
    </div>
  );

  if (searchParams.view === "week") {
    const start = startOfWeek(searchParams.week && isISODate(searchParams.week) ? searchParams.week : todayISO());
    const days = Array.from({ length: 7 }, (_, i) => addDays(start, i));
    const today = todayISO();
    const nameOf = (id: string | null) => employees.find((e) => e.id === id)?.name ?? "Unassigned";
    const weekHref = (d: string) => `/tasks/recurring?view=week&week=${d}`;
    return (
      <>
        {tabs}
        <div className="row" style={{ marginBottom: ".75rem" }}>
          <Link className="btn secondary" href={weekHref(addDays(start, -7))} aria-label="Previous week">←</Link>
          <Link className="btn secondary" href={weekHref(startOfWeek(today))}>This week</Link>
          <Link className="btn secondary" href={weekHref(addDays(start, 7))} aria-label="Next week">→</Link>
          <strong style={{ margin: "0 .5rem" }}>{formatShort(start)} – {formatShort(addDays(start, 6))}</strong>
        </div>
        <div className="week-tasks">
          {days.map((d) => {
            const due = rows.filter((r) => r.active && isOccurrence(r, d));
            return (
              <section key={d} className={`card week-day${d === today ? " today" : ""}`} aria-label={formatShort(d)}>
                <h3 style={{ margin: "0 0 .4rem" }}>{formatShort(d)}</h3>
                {due.length === 0 ? (
                  <p className="muted small" style={{ margin: 0 }}>Nothing recurring.</p>
                ) : (
                  <ul style={{ margin: 0, paddingLeft: "1.1rem" }}>
                    {due.map((r) => (
                      <li key={r.id}>
                        {r.title}
                        <span className="muted small"> · {nameOf(r.assigneeId)} · {describeRule(r)}</span>
                      </li>
                    ))}
                  </ul>
                )}
              </section>
            );
          })}
        </div>
      </>
    );
  }

  return (
    <>
    {tabs}
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
    </>
  );
}
