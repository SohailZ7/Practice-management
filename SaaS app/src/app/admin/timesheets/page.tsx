import Link from "next/link";
import { db } from "@/lib/db";
import { requireAdmin } from "@/lib/session";
import { todayISO } from "@/lib/dates";
import { Banner } from "@/components/Banner";
import { ConfirmButton } from "@/components/ConfirmButton";
import { ensureEmployees } from "@/lib/timesheets/queries";
import {
  chargeCents,
  formatDuration,
  formatMoney,
  isMonthKey,
  minutesWorked,
  monthKey,
  monthLabel,
  monthTabs,
  sortEntries,
  timeInputValue,
  timesheetAccess,
  totals,
} from "@/lib/timesheets/calc";
import { addTimesheetEntry, deleteTimesheetEntry, setEmployeeRate, updateTimesheetEntry } from "./actions";

export default async function Page({ searchParams }: { searchParams: { e?: string; m?: string; error?: string; notice?: string } }) {
  const user = await requireAdmin();
  if (timesheetAccess(user) !== "all") return <p className="muted">No access.</p>;

  const employees = await ensureEmployees();
  const emp = employees.find((e) => e.id === searchParams.e) ?? employees[0];
  const all = await db.timesheetEntry.findMany({ where: { employeeId: emp.id } });
  const thisMonth = todayISO().slice(0, 7);
  const months = monthTabs(all.map((r) => r.date), thisMonth);
  const month = searchParams.m && isMonthKey(searchParams.m) ? searchParams.m : thisMonth;
  const rows = sortEntries(all.filter((r) => monthKey(r.date) === month));
  const sum = totals(rows);
  const link = (e: string, m: string) => `/admin/timesheets?e=${encodeURIComponent(e)}&m=${m}`;

  return (
    <>
      <Banner error={searchParams.error} notice={searchParams.notice} />
      <h2>Timesheets</h2>
      <p className="muted small">Admin only. Charge is minutes ÷ 60 × the entry&apos;s hourly rate, rounded to the cent. Each entry has its own rate; a new entry starts at the employee&apos;s default rate.</p>

      <div className="tabs" role="tablist" aria-label="Employee">
        {employees.map((e) => (
          <Link key={e.id} href={link(e.id, month)} role="tab" aria-selected={e.id === emp.id} className={e.id === emp.id ? "tab on" : "tab"}>
            {e.name}
          </Link>
        ))}
      </div>
      <div className="tabs" role="tablist" aria-label="Month">
        {months.map((m) => (
          <Link key={m} href={link(emp.id, m)} role="tab" aria-selected={m === month} className={m === month ? "tab on" : "tab"}>
            {monthLabel(m)}
          </Link>
        ))}
      </div>

      <form action={setEmployeeRate} className="row small" style={{ margin: ".5rem 0" }}>
        <input type="hidden" name="employeeId" value={emp.id} />
        <label>
          {emp.name}&apos;s default rate per hour{" "}
          <input name="rate" defaultValue={(emp.defaultRateCents / 100).toFixed(2)} inputMode="decimal" style={{ width: 90 }} />
        </label>
        <button type="submit" className="secondary">Save default</button>
      </form>

      <form action={addTimesheetEntry} className="card row">
        <input type="hidden" name="employeeId" value={emp.id} />
        <input name="date" type="date" defaultValue={month === thisMonth ? todayISO() : `${month}-01`} aria-label="Date" required />
        <input name="start" type="time" aria-label="Start time" required />
        <input name="end" type="time" aria-label="End time" required />
        <input name="rate" defaultValue={(emp.defaultRateCents / 100).toFixed(2)} inputMode="decimal" aria-label="Rate per hour" style={{ width: 90 }} />
        <button type="submit">Add entry</button>
      </form>

      <div className="table-wrap">
        <table>
          <thead>
            <tr>
              <th>Date</th>
              <th>Start Time</th>
              <th>End Time</th>
              <th>Minutes Worked</th>
              <th>Rate / Hr</th>
              <th>Charge</th>
              <th />
            </tr>
          </thead>
          <tbody>
            {rows.map((r) => {
              const m = minutesWorked(r.startMin, r.endMin);
              const f = `ts-${r.id}`;
              return (
                <tr key={r.id}>
                  <td>
                    <form id={f} action={updateTimesheetEntry}>
                      <input type="hidden" name="id" value={r.id} />
                    </form>
                    <input form={f} name="date" type="date" defaultValue={r.date} aria-label="Date" />
                  </td>
                  <td><input form={f} name="start" type="time" defaultValue={timeInputValue(r.startMin)} aria-label="Start time" /></td>
                  <td><input form={f} name="end" type="time" defaultValue={timeInputValue(r.endMin)} aria-label="End time" /></td>
                  <td>{m}</td>
                  <td><input form={f} name="rate" defaultValue={(r.rateCents / 100).toFixed(2)} inputMode="decimal" aria-label="Rate per hour" style={{ width: 80 }} /></td>
                  <td>{formatMoney(chargeCents(m, r.rateCents))}</td>
                  <td className="row">
                    <button form={f} type="submit">Save</button>
                    <form action={deleteTimesheetEntry}>
                      <input type="hidden" name="id" value={r.id} />
                      <ConfirmButton message="Delete this entry?">Delete</ConfirmButton>
                    </form>
                  </td>
                </tr>
              );
            })}
            {rows.length === 0 && (
              <tr>
                <td colSpan={7} className="muted">No entries for {monthLabel(month)}.</td>
              </tr>
            )}
          </tbody>
          <tfoot>
            <tr>
              <th colSpan={3}>{emp.name}, {monthLabel(month)}: {sum.entries} {sum.entries === 1 ? "entry" : "entries"}</th>
              <th>{sum.minutes} ({formatDuration(sum.minutes)})</th>
              <th />
              <th>{formatMoney(sum.chargeCents)}</th>
              <th />
            </tr>
          </tfoot>
        </table>
      </div>
      <p>
        <a href={`/admin/timesheets/export?e=${encodeURIComponent(emp.id)}&m=${month}`}>Download CSV for {emp.name}, {monthLabel(month)}</a>
      </p>
    </>
  );
}
