import { db } from "@/lib/db";
import { requireAdmin } from "@/lib/session";
import { LEVELS, MODULES, ROLES } from "@/lib/access";
import { Banner } from "@/components/Banner";
import { addUser, setAccess, updateUser } from "./actions";

export default async function AdminPage({
  searchParams,
}: {
  searchParams: { error?: string; notice?: string };
}) {
  await requireAdmin();
  const [users, log] = await Promise.all([
    db.user.findMany({ orderBy: { createdAt: "asc" }, include: { access: true } }),
    db.auditLog.findMany({ orderBy: { createdAt: "desc" }, take: 50 }),
  ]);

  return (
    <>
      <h1>Access</h1>
      <Banner error={searchParams.error} notice={searchParams.notice} />
      <p className="muted">
        Only people listed here can sign in (with their Google account). Choose what each person can
        open. Admins can open everything.
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
