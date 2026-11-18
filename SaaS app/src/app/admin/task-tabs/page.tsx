import { db } from "@/lib/db";
import { requireAdmin } from "@/lib/session";
import { audit } from "@/lib/audit";
import { Banner } from "@/components/Banner";
import { BulkSave } from "@/components/BulkSave";
import { addTaskTab, removeTaskTab, setTaskViewers } from "../actions";

export default async function Page({ searchParams }: { searchParams: { error?: string; notice?: string } }) {
  const me = await requireAdmin();
  const [employees, users, viewers] = await Promise.all([
    db.employee.findMany({ where: { active: true }, orderBy: { name: "asc" }, select: { id: true, name: true, email: true, taskTab: true } }),
    db.user.findMany({ orderBy: { createdAt: "asc" }, select: { id: true, name: true, email: true, role: true } }),
    db.taskViewer.findMany({ select: { userId: true, employeeId: true, level: true } }),
  ]);

  return (
    <>
      <Banner error={searchParams.error} notice={searchParams.notice} />
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

      <h2>Who can see and edit whose tab</h2>
      <p className="muted small">
        Everyone edits their own tab. For every other tab choose what each person can do: no access, view (read-only) or
        edit. Admins see and edit everything.
      </p>
      <BulkSave>
        {users
          .filter((u) => u.role !== "ADMIN")
          .map((u) => {
            const granted = new Map(viewers.filter((v) => v.userId === u.id).map((v) => [v.employeeId, v.level]));
            return (
              <form key={u.id} action={setTaskViewers} data-bulk="taskviewers" className="card row bulk-row">
                <input type="hidden" name="id" value={u.id} />
                <strong style={{ minWidth: 130 }}>{u.name}</strong>
                {employees
                  .filter((e) => e.taskTab && e.email !== u.email)
                  .map((e) => (
                    <label key={e.id} className="check">
                      {e.name}{" "}
                      <select name={`tab_${e.id}`} defaultValue={granted.get(e.id) ?? "none"} aria-label={`${u.name} on ${e.name}'s tab`}>
                        <option value="none">no access</option>
                        <option value="view">view</option>
                        <option value="edit">edit</option>
                      </select>
                    </label>
                  ))}
                <span className="grow" />
                <button type="submit" className="secondary">Save</button>
              </form>
            );
          })}
      </BulkSave>
    </>
  );
}
