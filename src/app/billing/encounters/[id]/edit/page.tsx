import Link from "next/link";
import { notFound } from "next/navigation";
import { db } from "@/lib/db";
import { requireAccess } from "@/lib/session";
import { canChangeEncounter } from "@/lib/billing/rules";
import { patientScope } from "@/lib/billing/scope";
import { todayInPractice } from "@/lib/billing/validate";
import { EncounterForm } from "@/components/billing/EncounterForm";

export default async function EditEncounterPage({ params }: { params: { id: string } }) {
  const user = await requireAccess("billing", "edit");
  const enc = await db.encounter.findUnique({ where: { id: params.id }, include: { patient: true } });
  if (!enc) notFound();
  const visible = await db.billingPatient.findFirst({ where: { id: enc.patientId, ...patientScope(user) } });
  if (!visible) notFound();

  if (!canChangeEncounter(user, enc)) {
    return (
      <div className="card">
        <p>
          This encounter can&apos;t be changed. Only the person who entered it (or an admin) can edit it, and not while
          it is marked as entered into GetIX or after it was deleted.
        </p>
        <Link href={`/billing/patients/${enc.patientId}`}>Back to the patient</Link>
      </div>
    );
  }

  const programs = await db.program.findMany({
    where: { OR: [{ active: true }, { id: enc.programId }] },
    orderBy: { name: "asc" },
    select: { id: true, name: true },
  });
  return (
    <>
      <h2 style={{ marginTop: 0 }}>Edit encounter</h2>
      <EncounterForm
        programs={programs}
        today={todayInPractice()}
        edit={{
          encounterId: enc.id,
          patientLabel: `${enc.patient.lastName}, ${enc.patient.firstName}${enc.patient.mrn ? ` (MRN ${enc.patient.mrn})` : " (No MRN yet)"}`,
          encounterDate: enc.encounterDate,
          programId: enc.programId,
          icd10Input: enc.icd10Codes.join(", "),
          chargeCode: enc.chargeCode,
          note: enc.note,
        }}
      />
    </>
  );
}
