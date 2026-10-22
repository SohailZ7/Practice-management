import Link from "next/link";
import { db } from "@/lib/db";
import { requireAdmin } from "@/lib/session";
import { audit } from "@/lib/audit";
import { LEVELS, MODULES, ROLES } from "@/lib/access";
import { Banner } from "@/components/Banner";
import { addTaskTab, addUser, removeTaskTab, revokeDesktopSessions, setAccess, setTaskViewers, updateUser } from "./actions";

export default async function AdminPage({
  searchParams,
}: {
  searchParams: { error?: string; notice?: string };
}) {
  const admin = await requireAdmin();
  const [users, employees, viewers, log] = await Promise.all([
    db.user.findMany({ orderBy: { createdAt: "asc" }, include: { access: true } }),
    db.employee.findMany({ where: { active: true }, orderBy: { name: "asc" }, select: { id: true, name: true, email: true, taskTab: true } }),
    db.taskViewer.findMany({ select: { userId: true, employeeId: true, level: true } }),
    db.auditLog.findMany({ orderBy: { createdAt: "desc" }, take: 50 }),
  ]);

  await audit(admin.email, "audit.view", "recent activity on the Access page (50 rows)");
  return (
    <>
      <h1>Admin console</h1>
      <Banner error={searchParams.error} notice={searchParams.notice} />
      <p className="muted">
        Only people listed here can sign in (with their Google account). Choose what each person can
        open. Admins can open everything.
      </p>

      <p>
        <Link href="/admin/access-review">Access review</Link>{" "}
        <span className="muted small">— who can sign in, last sign-ins, flags, and the full audit log (quarterly review recommended)</span>
      </p>

      <h2>Users</h2>
      <div className="table-wrap">
        <table>
          <thead>
            <tr>
              <th>Name</th>
              <th>Email</th>
              <th>Role</th>
              <th>Active</th>
              <th></th>
            </tr>
          </thead>
          <tbody>
            {users.map((u) => (
              <tr key={u.id}>
                <td>{u.name}</td>
                <td>{u.email}</td>
                <td colSpan={3}>
                  <form action={updateUser} className="row">
                    <input type="hidden" name="id" value={u.id} />
                    <select name="role" defaultValue={u.role}>
                      {ROLES.map((r) => (
                        <option key={r} value={r}>
                          {r}
                        </option>
                      ))}
                    </select>
                    <label className="check">
                      <input type="checkbox" name="active" defaultChecked={u.active} /> Active
                    </label>
                    <button type="submit" className="secondary">
                      Save
                    </button>
                  </form>
                  <form action={revokeDesktopSessions} className="row">
                    <input type="hidden" name="id" value={u.id} />
                    <button type="submit" className="secondary" title="Sign this user out of the Mac Desktop App everywhere">
                      Sign out Mac app
                    </button>
                  </form>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>

      <h2>Module access</h2>
      <div className="table-wrap">
        <table className="matrix">
          <thead>
            <tr>
              <th>User</th>
              {MODULES.map((m) => (
                <th key={m}>{m}</th>
              ))}
              <th></th>
            </tr>
          </thead>
          <tbody>
            {users.map((u) => (
              <tr key={u.id}>
                <td>
                  {u.name}
                  {u.role === "ADMIN" && <span className="pill"> admin: all</span>}
                </td>
                <td colSpan={MODULES.length + 1}>
                  <form action={setAccess} className="row" style={{ justifyContent: "space-around" }}>
                    <input type="hidden" name="id" value={u.id} />
                    {MODULES.map((m) => (
                      <select
                        key={m}
                        name={`level_${m}`}
                        defaultValue={u.access.find((a) => a.module === m)?.level ?? "none"}
                        disabled={u.role === "ADMIN"}
                        aria-label={`${u.name} ${m}`}
                      >
                        {LEVELS.map((l) => (
                          <option key={l} value={l}>
                            {l}
                          </option>
                        ))}
                      </select>
                    ))}
                    <button type="submit" className="secondary" disabled={u.role === "ADMIN"}>
                      Save
                    </button>
                  </form>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>

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

      <h2>Add a user</h2>
      <form action={addUser} className="card row">
        <input name="name" placeholder="Name" required className="grow" />
        <input name="email" type="email" placeholder="Google email" required className="grow" />
        <select name="role" defaultValue="STAFF">
          {ROLES.map((r) => (
            <option key={r} value={r}>
              {r}
            </option>
          ))}
        </select>
        <button type="submit">Add user</button>
      </form>

      <h2>Recent activity</h2>
      <div className="table-wrap">
        <table>
          <thead>
            <tr>
              <th>When</th>
              <th>Who</th>
              <th>Action</th>
              <th>Detail</th>
            </tr>
          </thead>
          <tbody>
            {log.map((l) => (
              <tr key={l.id}>
                <td className="small">{l.createdAt.toISOString().replace("T", " ").slice(0, 19)}</td>
                <td>{l.actorEmail}</td>
                <td>{l.action}</td>
                <td className="small muted">{l.detail}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </>
  );
}
