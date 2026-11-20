import Link from "next/link";
import { db } from "@/lib/db";
import { requireAccess } from "@/lib/session";
import { audit } from "@/lib/audit";
import { canAccess } from "@/lib/access";
import { Banner } from "@/components/Banner";
import { addProvider, saveProvider, addTimeOff, removeTimeOff } from "./actions";
import { TIME_OFF_KINDS, kindLabel, formatRange } from "@/lib/schedule/timeOff";

export default async function ProvidersPage({
  searchParams,
}: {
  searchParams: { error?: string; notice?: string };
}) {
  const user = await requireAccess("schedule", "view");
  const canEdit = canAccess(user, "schedule", "edit");
  await audit(user.email, "providers.view", canEdit ? "with NPI and Zoom details" : "directory only");
  const [providers, employees] = await Promise.all([
    db.provider.findMany({ orderBy: { name: "asc" }, include: { employee: true, timeOff: { orderBy: { startDate: "asc" } } } }),
    db.employee.findMany({ where: { active: true, provider: null }, orderBy: { name: "asc" } }),
  ]);

  const today = new Date().toISOString().slice(0, 10);

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
              <label className="small" title="Counted for patients seen and revenue left on the table. Never reaches billing, documents, invoices or timesheets.">
                <input type="checkbox" name="trackingOnly" defaultChecked={p.trackingOnly} /> Not B&amp;B (tracking only)
              </label>
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

      <h2>Days unavailable</h2>
      <p className="muted small">
        Vacation, sick days, training or limitations. Informational: it does not block or change any visit already on the schedule.
      </p>
      {providers.map((p) => {
        const upcoming = p.timeOff.filter((t) => t.endDate >= today);
        return (
          <div key={p.id} className="card">
            <strong>{p.name}</strong>
            {upcoming.length === 0 ? (
              <p className="muted small">No upcoming unavailable days.</p>
            ) : (
              <div className="table-wrap">
                <table>
                  <thead>
                    <tr>
                      <th>Dates</th>
                      <th>Type</th>
                      <th>Note</th>
                      {canEdit && <th aria-label="Actions" />}
                    </tr>
                  </thead>
                  <tbody>
                    {upcoming.map((t) => (
                      <tr key={t.id}>
                        <td>{formatRange(t)}</td>
                        <td>{kindLabel(t.kind)}</td>
                        <td>{t.note}</td>
                        {canEdit && (
                          <td>
                            <form action={removeTimeOff}>
                              <input type="hidden" name="id" value={t.id} />
                              <button type="submit" aria-label={`Remove ${formatRange(t)} for ${p.name}`}>Remove</button>
                            </form>
                          </td>
                        )}
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            )}
            {canEdit && (
              <form action={addTimeOff} className="row" style={{ marginTop: ".5rem" }}>
                <input type="hidden" name="providerId" value={p.id} />
                <input type="date" name="startDate" required aria-label={`Start date for ${p.name}`} />
                <input type="date" name="endDate" aria-label={`End date for ${p.name} (optional)`} />
                <select name="kind" defaultValue="time_off" aria-label="Type">
                  {TIME_OFF_KINDS.map((k) => (
                    <option key={k.value} value={k.value}>{k.label}</option>
                  ))}
                </select>
                <input name="note" placeholder="Note" className="grow" aria-label="Note" />
                <button type="submit">Add</button>
              </form>
            )}
          </div>
        );
      })}

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
