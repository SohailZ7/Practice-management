import { BulkSave } from "@/components/BulkSave";
import { ROLES, LEVELS, MODULES } from "@/lib/access";
import { ConfirmButton } from "@/components/ConfirmButton";
import { addUser, deleteUser, revokeDesktopSessions, updatePerson } from "@/app/admin/actions";
import type { Prisma } from "@prisma/client";

type Person = Prisma.UserGetPayload<{ include: { access: true } }>;

/** Logins, roles, flags and module access: one row per person; Save all saves every changed row. Admin only (the actions check it too). Shown on the Employees page. */
export function PeopleSection({ users, meId }: { users: Person[]; meId: string }) {
  const me = { id: meId };
  return (
    <section id="logins" aria-label="Logins and access">
      <h2>Logins and access</h2>
      <p className="muted">
        Only people listed here can sign in (with their Google account). Change a name, email, role or access, deactivate (reversible) or delete a login.
        Admins can open everything. The staff records above (title, phone, and the email used to match providers, schedules and task tabs) are separate from the login.
      </p>
      <BulkSave>
        {users.map((u) => (
          <section key={u.id} className="card bulk-row" aria-label={u.name}>
            <form action={updatePerson} data-bulk="people" className="person">
              <input type="hidden" name="id" value={u.id} />
              <div className="row">
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
                <select name="role" defaultValue={u.role} aria-label={`Role of ${u.name}`}>
                  {ROLES.map((r) => (
                    <option key={r} value={r}>{r}</option>
                  ))}
                </select>
              </div>
              <div className="row" style={{ marginTop: ".4rem" }}>
                <label className="check"><input type="checkbox" name="active" defaultChecked={u.active} /> Active</label>
                <label className="check" title="Shows full patient names to this person: in the Mac app, and on the web Schedule and print page when they are a Provider or Admin. Initials otherwise.">
                  <input type="checkbox" name="showFullNames" defaultChecked={u.showFullNames} /> Show full patient names
                </label>
                <label className="check" title="Can approve, request changes on, or reject Feedback items that are On staging">
                  <input type="checkbox" name="feedbackApprover" defaultChecked={u.feedbackApprover} /> Feedback approver
                </label>
              </div>
              <div className="row access" style={{ marginTop: ".4rem" }}>
                {u.role === "ADMIN" ? (
                  <span className="pill">admin: all areas</span>
                ) : (
                  MODULES.map((m) => (
                    <label key={m} className="check">
                      {m}{" "}
                      <select name={`level_${m}`} defaultValue={u.access.find((a) => a.module === m)?.level ?? "none"} aria-label={`${u.name} ${m}`}>
                        {LEVELS.map((l) => (
                          <option key={l} value={l}>{l}</option>
                        ))}
                      </select>
                    </label>
                  ))
                )}
                <span className="grow" />
                <button type="submit" className="secondary">Save</button>
              </div>
            </form>
            <div className="row" style={{ marginTop: ".4rem" }}>
              <form action={revokeDesktopSessions}>
                <input type="hidden" name="id" value={u.id} />
                <button type="submit" className="secondary" title="Sign this user out of the Mac Desktop App everywhere">Sign out Mac app</button>
              </form>
              <form action={deleteUser}>
                <input type="hidden" name="id" value={u.id} />
                <ConfirmButton message={`Delete the login for ${u.email}? They will no longer be able to sign in. Their tasks and employee record are kept.`} disabled={u.id === me.id} title={u.id === me.id ? "You can't delete your own login" : "Delete this login"}>
                  Delete
                </ConfirmButton>
              </form>
            </div>
          </section>
        ))}
      </BulkSave>

      <h3>Add a person</h3>
      <form action={addUser} className="card row">
        <input name="name" placeholder="Name" required className="grow" />
        <input name="email" type="email" placeholder="Google email" required className="grow" />
        <select name="role" defaultValue="STAFF" aria-label="Role">
          {ROLES.map((r) => (
            <option key={r} value={r}>{r}</option>
          ))}
        </select>
        <button type="submit">Add person</button>
      </form>
    </section>
  );
}
