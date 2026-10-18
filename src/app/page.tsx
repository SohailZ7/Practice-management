import Link from "next/link";
import { requireUser, levels } from "@/lib/session";
import { canOpenAdmin } from "@/lib/access";
import { db } from "@/lib/db";
import { todayISO } from "@/lib/dates";
import { ensureRecurringTasks } from "@/lib/recurring";

export default async function Home() {
  const user = await requireUser();
  const lv = levels(user);
  const today = todayISO();
  await ensureRecurringTasks();

  const [entryCount, myOpen] = await Promise.all([
    lv.schedule !== "none" ? db.scheduleEntry.count({ where: { date: today } }) : Promise.resolve(0),
    lv.tasks !== "none"
      ? db.task.count({
          where: { completed: false, assignee: { email: user.email } },
        })
      : Promise.resolve(0),
  ]);

  return (
    <>
      <h1>Hello, {user.name}</h1>
      <div className="row" style={{ alignItems: "stretch" }}>
        {lv.schedule !== "none" && (
          <Link href="/schedule" className="card grow">
            <strong>Schedule</strong>
            <div className="muted">{entryCount} entries today</div>
          </Link>
        )}
        {lv.tasks !== "none" && (
          <Link href="/tasks" className="card grow">
            <strong>Tasks</strong>
            <div className="muted">{myOpen} open assigned to you</div>
          </Link>
        )}
        {lv.employees !== "none" && (
          <Link href="/employees" className="card grow">
            <strong>Employees</strong>
            <div className="muted">Directory</div>
          </Link>
        )}
        {lv.billing !== "none" && (
          <Link href="/billing" className="card grow">
            <strong>Billing</strong>
            <div className="muted">Encounters and GetIX</div>
          </Link>
        )}
        {lv.ledger !== "none" && (
          <Link href="/ledger" className="card grow">
            <strong>Ledger</strong>
            <div className="muted">Business cash in and out</div>
          </Link>
        )}
        {canOpenAdmin(user) && (
          <Link href="/admin" className="card grow">
            <strong>Access</strong>
            <div className="muted">Users and module access</div>
          </Link>
        )}
      </div>
    </>
  );
}
