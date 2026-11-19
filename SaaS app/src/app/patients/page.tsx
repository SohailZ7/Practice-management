import Link from "next/link";
import { requireAccess } from "@/lib/session";
import { audit } from "@/lib/audit";
import { todayISO } from "@/lib/dates";
import { canSeeFullNames } from "@/lib/fullNames";
import { initialsFor } from "@/lib/prefs";
import { patientList } from "@/lib/patients/queries";
import { PatientName } from "@/components/PatientName";

// Patients tab (phase 0): everything is derived from existing Visits and ScheduleEntry rows. Needs the notes module (patient names).
export default async function PatientsTab({ searchParams }: { searchParams: { q?: string } }) {
  const user = await requireAccess("notes", "view");
  const q = (searchParams.q ?? "").slice(0, 60);
  const rows = await patientList(q, todayISO());
  const full = canSeeFullNames(user);
  await audit(user.email, "patients.list", `${rows.length} row(s)`);
  return (
    <>
      <h2>Patients</h2>
      <form method="get" className="row" style={{ marginBottom: "1rem" }}>
        <input name="q" defaultValue={q} placeholder="Name or MRN" aria-label="Search patients" />
        <button className="btn" type="submit">Search</button>
      </form>
      <table>
        <thead>
          <tr><th>Patient</th><th>Providers (visits)</th><th>Appts</th><th>Seen</th><th>Absent</th><th>Missed</th><th>Cancelled</th><th>Upcoming</th><th>Last seen</th><th>Last provider</th><th>Program</th><th>Visit types</th></tr>
        </thead>
        <tbody>
          {rows.map((r) => (
            <tr key={r.patientId}>
              <td><Link href={`/patients/${r.patientId}`}><PatientName initials={initialsFor(r.name)} fullName={full ? r.name : null} /></Link></td>
              <td>{r.providers.map((p) => `${p.name} (${p.visits})`).join(", ")}</td>
              <td>{r.appointments}</td><td>{r.seen}</td><td>{r.absent}</td><td>{r.missed}</td><td>{r.canceled}</td><td>{r.upcoming}</td>
              <td>{r.lastSeen}</td><td>{r.lastProvider}</td><td>{r.currentProgram}</td><td>{r.visitTypes.join(", ")}</td>
            </tr>
          ))}
        </tbody>
      </table>
      {rows.length === 0 && <p className="muted">No patients match.</p>}
    </>
  );
}
