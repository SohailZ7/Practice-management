import { db } from "@/lib/db";
import { requireAccess } from "@/lib/session";
import { defaultPatientFilters, queryPatients } from "@/lib/billing/queries";
import { isAdmin } from "@/lib/billing/rules";
import { PatientList } from "@/components/billing/PatientList";

export default async function PatientsPage() {
  const user = await requireAccess("billing", "view");
  const filters = defaultPatientFilters();
  const [rows, programs, people] = await Promise.all([
    queryPatients(user, filters),
    db.program.findMany({ orderBy: { name: "asc" }, select: { id: true, name: true } }),
    isAdmin(user) ? db.user.findMany({ orderBy: { name: "asc" }, select: { id: true, name: true } }) : Promise.resolve([]),
  ]);
  return <PatientList initialRows={rows} initialFilters={filters} programs={programs} people={people} isAdmin={isAdmin(user)} />;
}
