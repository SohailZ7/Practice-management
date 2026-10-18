import Link from "next/link";
import { notFound } from "next/navigation";
import { db } from "@/lib/db";
import { audit } from "@/lib/audit";
import { requireAccess } from "@/lib/session";
import { canAccess } from "@/lib/access";
import { canChangeEncounter, isAdmin } from "@/lib/billing/rules";
import { patientScope } from "@/lib/billing/scope";
import { userNames } from "@/lib/billing/queries";
import { PatientAdmin } from "@/components/billing/PatientAdmin";
import { PatientEncounters } from "@/components/billing/PatientEncounters";

export default async function PatientPage({ params }: { params: { id: string } }) {
  const user = await requireAccess("billing", "view");
  const admin = isAdmin(user);
  const patient = await db.billingPatient.findFirst({ where: { id: params.id, ...patientScope(user) } });
  if (!patient) notFound();

  const encounters = await db.encounter.findMany({
    where: { patientId: patient.id, ...(admin ? {} : { deletedAt: null }) },
    include: { program: true },
    orderBy: [{ encounterDate: "desc" }, { createdAt: "desc" }],
  });
  const names = await userNames(encounters.map((e) => e.createdById));
  await audit(user.email, "billing.patient.view", `patient ${patient.id}`);

  const rows = encounters.map((e) => ({
    id: e.id,
    date: e.encounterDate,
    program: e.program.name,
    icd10Codes: e.icd10Codes,
    chargeCode: e.chargeCode,
    note: e.note,
    enteredBy: names.get(e.createdById) ?? "",
    getixEntered: e.getixEntered,
    getixEnteredAt: e.getixEnteredAt ? e.getixEnteredAt.toISOString().slice(0, 10) : null,
    deleted: e.deletedAt !== null,
    canChange: canChangeEncounter(user, e),
  }));

  return (
    <>
      <p>
        <Link href="/billing/patients">← Patients</Link>
      </p>
      <div className="row" style={{ marginBottom: "1rem" }}>
        <h2 style={{ margin: 0 }}>
          {patient.lastName}, {patient.firstName}
        </h2>
        {patient.mrn ? <span className="pill">MRN {patient.mrn}</span> : <span className="pill warn">No MRN yet</span>}
        <span className="grow" />
        {canAccess(user, "billing", "edit") && (
          <Link className="btn" href={`/billing/new?patient=${patient.id}`}>
            Add encounter for this patient
          </Link>
        )}
        {admin && (
          <Link className="btn secondary" href={`/billing/history?entity=patient&id=${patient.id}`}>
            History
          </Link>
        )}
      </div>
      {admin && <PatientAdmin patientId={patient.id} mrn={patient.mrn} lastName={patient.lastName} firstName={patient.firstName} />}
      <PatientEncounters rows={rows} isAdmin={admin} />
      <p className="muted small">
        You can see every encounter for this patient, including colleagues&apos;. You can change only the ones you entered
        that aren&apos;t locked in GetIX.
      </p>
    </>
  );
}
