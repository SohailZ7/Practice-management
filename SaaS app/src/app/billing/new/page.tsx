import { db } from "@/lib/db";
import { requireAccess } from "@/lib/session";
import { patientScope } from "@/lib/billing/scope";
import { todayInPractice } from "@/lib/billing/validate";
import { EncounterForm } from "@/components/billing/EncounterForm";

export default async function NewEncounterPage({ searchParams }: { searchParams: { patient?: string } }) {
  const user = await requireAccess("billing", "edit");
  const programs = await db.program.findMany({ where: { active: true }, orderBy: { name: "asc" }, select: { id: true, name: true } });
  const patient = searchParams.patient
    ? await db.billingPatient.findFirst({ where: { id: searchParams.patient, ...patientScope(user) } })
    : null;

  return (
    <>
      <h2 style={{ marginTop: 0 }}>New encounter</h2>
      {programs.length === 0 && (
        <div className="error">No programs yet. An administrator needs to add programs first (Billing → Programs).</div>
      )}
      <EncounterForm
        programs={programs}
        today={todayInPractice()}
        preset={patient ? { id: patient.id, mrn: patient.mrn, name: `${patient.lastName}, ${patient.firstName}` } : undefined}
      />
    </>
  );
}
