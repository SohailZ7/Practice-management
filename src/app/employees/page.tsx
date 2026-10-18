import { db } from "@/lib/db";
import { requireAccess } from "@/lib/session";
import { canAccess } from "@/lib/access";
import { Banner } from "@/components/Banner";
import { addEmployee, giveLogin, updateEmployee } from "./actions";

export default async function EmployeesPage({
  searchParams,
}: {
  searchParams: { error?: string; notice?: string };
}) {
  const user = await requireAccess("employees", "view");
  const canEdit = canAccess(user, "employees", "edit");
  const isAdmin = user.role === "ADMIN";
  const [employees, users] = await Promise.all([
    db.employee.findMany({ orderBy: [{ active: "desc" }, { name: "asc" }] }),
    db.user.findMany({ select: { email: true } }),
  ]);
  const loginEmails = new Set(users.map((u) => u.email));

  return (
    <>
      <h1>Employees</h1>
      <Banner error={searchParams.error} notice={searchParams.notice} />

      <div className="table-wrap">
        <table>
          <thead>
            <tr>
              <th>Name</th>
              <th>Title</th>
              <th>Email</th>
              <th>Phone</th>
              <th>Status</th>
              {canEdit && <th></th>}
            </tr>
          </thead>
          <tbody>
            {employees.map((e) =>
              canEdit ? (
                <tr key={e.id}>
                  <td colSpan={6}>
                    <form action={updateEmployee} className="row">
                      <input type="hidden" name="id" value={e.id} />
                      <input name="name" defaultValue={e.name} required className="grow" />
                      <input name="title" defaultValue={e.title} placeholder="Title" className="grow" />
                      <input name="email" defaultValue={e.email ?? ""} placeholder="Email" className="grow" />
                      <input name="phone" defaultValue={e.phone} placeholder="Phone" />
                      <label className="check">
                        <input type="checkbox" name="active" defaultChecked={e.active} /> Active
                      </label>
                      {e.email && loginEmails.has(e.email) && <span className="pill ok">has login</span>}
                      <button type="submit" className="secondary">
                        Save
                      </button>
                    </form>
                    {isAdmin && e.email && !loginEmails.has(e.email) && (
                      <form action={giveLogin} style={{ marginTop: ".35rem" }}>
                        <input type="hidden" name="id" value={e.id} />
                        <button type="submit">Give login ({e.email})</button>
                        <span className="muted small"> so they can sign in with Google and see their own tasks</span>
                      </form>
                    )}
                  </td>
                </tr>
              ) : (
                <tr key={e.id}>
                  <td>{e.name}</td>
                  <td>{e.title}</td>
                  <td>{e.email}</td>
                  <td>{e.phone}</td>
                  <td>{e.active ? "Active" : "Inactive"}</td>
                </tr>
              ),
            )}
          </tbody>
        </table>
      </div>

      {canEdit && (
        <>
          <h2>Add an employee</h2>
          <form action={addEmployee} className="card row">
            <input name="name" placeholder="Name" required className="grow" />
            <input name="title" placeholder="Title" className="grow" />
            <input name="email" type="email" placeholder="Email (matches their Google login)" className="grow" />
            <input name="phone" placeholder="Phone" />
            <button type="submit">Add</button>
          </form>
          <p className="muted small">
            Deactivating an employee keeps their history on schedules and tasks. Giving someone a login
            is done under Access.
          </p>
        </>
      )}
    </>
  );
}
