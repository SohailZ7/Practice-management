import { db } from "@/lib/db";
import { requireAdmin } from "@/lib/session";
import { audit } from "@/lib/audit";
import { Banner } from "@/components/Banner";
import { addTaskTab, removeTaskTab } from "../actions";

export default async function Page({ searchParams }: { searchParams: { error?: string; notice?: string } }) {
  const me = await requireAdmin();
  const [employees] = await Promise.all([
    db.employee.findMany({ where: { active: true }, orderBy: { name: "asc" }, select: { id: true, name: true, email: true, taskTab: true } }),
  ]);

  return (
    <>
      <Banner error={searchParams.error} notice={searchParams.notice} />
      <p className="muted">The employee tabs shown under Tasks.</p>
      <h2>Task tabs</h2>
      <p className="muted small">
        The employee tabs shown under Tasks. Removing a tab moves that person&apos;s open tasks to Unassigned (logged) and
        keeps their completed tasks; add the tab again to restore it.
      </p>
      <div className="table-wrap">
        <table>
          <tbody>
            {employees
              .filter((e) => e.taskTab)
              .map((e) => (
                <tr key={e.id}>
                  <td>{e.name}</td>
                  <td className="small muted">{e.email ?? "no login email"}</td>
                  <td>
                    <form action={removeTaskTab}>
                      <input type="hidden" name="employeeId" value={e.id} />
                      <button type="submit" className="secondary">
                        Remove tab
                      </button>
                    </form>
                  </td>
                </tr>
              ))}
          </tbody>
        </table>
      </div>
      <form action={addTaskTab} className="card row">
        <select name="employeeId" defaultValue="" aria-label="Existing employee">
          <option value="">New person…</option>
          {employees
            .filter((e) => !e.taskTab)
            .map((e) => (
              <option key={e.id} value={e.id}>
                {e.name}
              </option>
            ))}
        </select>
        <input name="name" placeholder="Name (new person)" className="grow" />
        <input name="email" type="email" placeholder="Email (optional)" className="grow" />
        <button type="submit">Add tab</button>
      </form>

    </>
  );
}
