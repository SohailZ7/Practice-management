import { db } from "@/lib/db";
import { requireAdmin } from "@/lib/session";
import { audit } from "@/lib/audit";
import { Banner } from "@/components/Banner";
import { ROLES } from "@/lib/access";
import { ConfirmButton } from "@/components/ConfirmButton";
import { addUser, deleteUser, revokeDesktopSessions, updateUser } from "./actions";

export default async function Page({ searchParams }: { searchParams: { error?: string; notice?: string } }) {
  const me = await requireAdmin();
  const [users] = await Promise.all([
    db.user.findMany({ orderBy: { createdAt: "asc" }, include: { access: true } }),
  ]);

  return (
    <>
      <Banner error={searchParams.error} notice={searchParams.notice} />
      <p className="muted">Only people listed here can sign in (with their Google account). Add a login, edit a name, email or role, deactivate (reversible) or delete it.</p>
      <h2>Users</h2>
      <div className="table-wrap">
        <table>
          <thead>
            <tr>
              <th>User</th>
              <th></th>
            </tr>
          </thead>
          <tbody>
            {users.map((u) => (
              <tr key={u.id}>
                <td colSpan={2}>
                  <form action={updateUser} className="row">
                    <input type="hidden" name="id" value={u.id} />
                    <input name="name" defaultValue={u.name} required aria-label={`Name of ${u.email}`} className="grow" />
                    <input
                      name="email"
                      type="email"
                      defaultValue={u.email}
                      required
                      readOnly={u.id === me.id}
                      title={u.id === me.id ? "You can't change the email of your own login" : "The Google account they sign in with"}
                      aria-label={`Email of ${u.name}`}
                      className="grow"
                    />
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
                    <label className="check" title="Lets this person's Mac recorder show full patient names (initials otherwise)">
                      <input type="checkbox" name="showFullNames" defaultChecked={u.showFullNames} /> Full names in recorder
                    </label>
                    <button type="submit" className="secondary">
                      Save
                    </button>
                  </form>
                  <form action={deleteUser} className="row">
                    <input type="hidden" name="id" value={u.id} />
                    <ConfirmButton message={`Delete the login for ${u.email}? They will no longer be able to sign in. Their tasks and employee record are kept.`} disabled={u.id === me.id} title={u.id === me.id ? "You can't delete your own login" : "Delete this login"}>
                      Delete
                    </ConfirmButton>
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

    </>
  );
}
