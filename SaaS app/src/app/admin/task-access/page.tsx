import { db } from "@/lib/db";
import { requireAdmin } from "@/lib/session";
import { audit } from "@/lib/audit";
import { Banner } from "@/components/Banner";
import { setTaskViewers } from "../actions";

export default async function Page({ searchParams }: { searchParams: { error?: string; notice?: string } }) {
  const me = await requireAdmin();
  const [users, employees, viewers] = await Promise.all([
    db.user.findMany({ orderBy: { createdAt: "asc" }, include: { access: true } }),
    db.employee.findMany({ where: { active: true }, orderBy: { name: "asc" }, select: { id: true, name: true, email: true, taskTab: true } }),
    db.taskViewer.findMany({ select: { userId: true, employeeId: true, level: true } }),
  ]);

  return (
    <>
      <Banner error={searchParams.error} notice={searchParams.notice} />
      <p className="muted">Who can see and edit whose task tab.</p>
      <h2>Task tab access</h2>
      <p className="muted small">
        Everyone edits their own tab. For every other tab choose what each person can do: no access, view (read-only) or
        edit. Admins see and edit everything.
      </p>
      {users
        .filter((u) => u.role !== "ADMIN")
        .map((u) => {
          const granted = new Map(viewers.filter((v) => v.userId === u.id).map((v) => [v.employeeId, v.level]));
          return (
            <form key={u.id} action={setTaskViewers} className="card row">
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
              <button type="submit" className="secondary">
                Save
              </button>
            </form>
          );
        })}

    </>
  );
}
