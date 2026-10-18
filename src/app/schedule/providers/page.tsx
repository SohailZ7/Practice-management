import Link from "next/link";
import { db } from "@/lib/db";
import { requireAccess } from "@/lib/session";
import { canAccess } from "@/lib/access";
import { Banner } from "@/components/Banner";
import { addProvider, saveProvider } from "./actions";

export default async function ProvidersPage({
  searchParams,
}: {
  searchParams: { error?: string; notice?: string };
}) {
  const user = await requireAccess("schedule", "view");
  const canEdit = canAccess(user, "schedule", "edit");
  const [providers, employees] = await Promise.all([
    db.provider.findMany({ orderBy: { name: "asc" }, include: { employee: true } }),
    db.employee.findMany({ where: { active: true, provider: null }, orderBy: { name: "asc" } }),
  ]);

  return (
    <>
      <p>
        <Link href="/schedule">← Schedule</Link>
      </p>
      <h1>Providers</h1>
      <Banner error={searchParams.error} notice={searchParams.notice} />
      {!canEdit && (
        <p className="muted small">NPI and Zoom details are visible to people with edit access to Schedule.</p>
      )}

      {canEdit ? (
        providers.map((p) => (
          <form key={p.id} action={saveProvider} className="card">
            <input type="hidden" name="id" value={p.id} />
            <div className="row">
              <input name="name" defaultValue={p.name} required className="grow" aria-label="Name" />
              <input name="contact" defaultValue={p.contact} placeholder="Contact #" />
              <input name="hours" defaultValue={p.hours} placeholder="Hours, e.g. M, T 8-2:00" />
              <span className={p.employee ? "pill ok" : "pill"}>
                {p.employee ? "employee" : "external"}
              </span>
            </div>
            <div className="row" style={{ marginTop: ".5rem" }}>
              <input name="npi" defaultValue={p.npi} placeholder="NPI #" />
              <input name="zoomLink" defaultValue={p.zoomLink} placeholder="Zoom link" className="grow" />
              <input name="zoomPassword" defaultValue={p.zoomPassword} placeholder="Zoom password" autoComplete="off" />
              <input name="notes" defaultValue={p.notes} placeholder="Notes" className="grow" />
              <button type="submit">Save</button>
            </div>
          </form>
        ))
      ) : (
        <div className="table-wrap">
          <table>
            <thead>
              <tr>
                <th>Name</th>
                <th>Contact</th>
                <th>Hours</th>
              </tr>
            </thead>
            <tbody>
              {providers.map((p) => (
                <tr key={p.id}>
                  <td>{p.name}</td>
                  <td>{p.contact}</td>
                  <td>{p.hours}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}

      {canEdit && (
        <>
          <h2>Add a provider</h2>
          <form action={addProvider} className="card row">
            <input name="name" placeholder="Name" required className="grow" />
            <select name="employeeId" defaultValue="">
              <option value="">External provider (not an employee)</option>
              {employees.map((e) => (
                <option key={e.id} value={e.id}>
                  Employee: {e.name}
                </option>
              ))}
            </select>
            <button type="submit">Add</button>
          </form>
        </>
      )}
    </>
  );
}
