import Link from "next/link";
import { notFound } from "next/navigation";
import { db } from "@/lib/db";
import { audit } from "@/lib/audit";
import { requireAccess, auditDenied } from "@/lib/session";
import { canAccess } from "@/lib/access";
import { canSeeFullNames } from "@/lib/fullNames";
import { initialsFor } from "@/lib/prefs";
import { LIVE_VISITS } from "@/lib/unify/visible";
import { statusLabel } from "@/lib/notes/visitStatus";
import { PatientName } from "@/components/PatientName";

// The chart: everything for one patient. Visits, documents and (for people with billing access) encounters.
export default async function PatientChart({ params }: { params: { id: string } }) {
  const user = await requireAccess("notes", "view");
  const patient = await db.patient.findFirst({ where: { id: params.id, mergedIntoId: null } });
  if (!patient) {
    await auditDenied(user.email, `patient ${params.id}`);
    notFound();
  }
  const billing = canAccess(user, "billing", "view");
  const [visits, entries, encounters] = await Promise.all([
    db.visit.findMany({
      where: { ...LIVE_VISITS, patientId: patient.id },
      orderBy: [{ visitDate: "desc" }, { createdAt: "desc" }],
      select: { id: true, visitDate: true, providerName: true, status: true, appointmentType: true, program: true, documents: { select: { id: true, kind: true, label: true, draft: true, updatedAt: true }, orderBy: { createdAt: "asc" } } },
    }),
    db.scheduleEntry.findMany({ where: { patientId: patient.id, visitId: null }, orderBy: { date: "desc" }, select: { id: true, date: true, providerName: true, trackName: true, typeName: true, completed: true, absent: true, canceled: true, missed: true } }),
    billing ? db.encounter.findMany({ where: { patientId: patient.id, deletedAt: null }, orderBy: { encounterDate: "desc" }, select: { id: true, encounterDate: true, chargeCode: true, getixEntered: true, program: { select: { name: true } } } }) : Promise.resolve([]),
  ]);
  await audit(user.email, "patients.chart.view", `patient ${patient.id}`);
  const name = `${patient.lastName}, ${patient.firstName}`;
  const full = canSeeFullNames(user);
  const flag = (e: (typeof entries)[number]) => (e.canceled ? "Cancelled" : e.absent ? "No-show" : e.missed ? "Missed" : e.completed ? "Seen" : "Scheduled");
  return (
    <>
      <p><Link href="/patients">← Patients</Link></p>
      <h2><PatientName initials={initialsFor(name)} fullName={full ? name : null} /></h2>
      <h3>Visits</h3>
      <table>
        <thead><tr><th>Date</th><th>Provider</th><th>Status</th><th>Type</th><th>Program</th><th>Documents</th></tr></thead>
        <tbody>
          {visits.map((v) => (
            <tr key={v.id}>
              <td>{v.visitDate}</td><td>{v.providerName}</td><td>{statusLabel(v.status)}</td><td>{v.appointmentType}</td><td>{v.program}</td>
              <td>{v.documents.map((d) => <Link key={d.id} href={`/schedule?view=day&date=${v.visitDate}`} className="pill">{d.label || d.kind}{d.draft ? " (draft)" : ""}</Link>)}</td>
            </tr>
          ))}
          {entries.map((e) => (
            <tr key={e.id}><td>{e.date}</td><td>{e.providerName}</td><td>{flag(e)}</td><td>{e.typeName}</td><td>{e.trackName}</td><td className="muted">schedule only</td></tr>
          ))}
        </tbody>
      </table>
      {visits.length + entries.length === 0 && <p className="muted">No appointments yet.</p>}
      {billing && (
        <>
          <h3>Billing encounters</h3>
          <table>
            <thead><tr><th>Date</th><th>Program</th><th>Charge code</th><th>In GetIX</th></tr></thead>
            <tbody>{encounters.map((e) => <tr key={e.id}><td>{e.encounterDate}</td><td>{e.program.name}</td><td>{e.chargeCode}</td><td>{e.getixEntered ? "Yes" : "No"}</td></tr>)}</tbody>
          </table>
          {encounters.length === 0 && <p className="muted">No encounters.</p>}
        </>
      )}
    </>
  );
}
