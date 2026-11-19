import { db } from "@/lib/db";
import { LIVE_VISITS } from "@/lib/unify/visible";
import { rollup, type PatientRollup } from "./stats";

const LIMIT = 500;

export type PatientListRow = PatientRollup & { name: string; mrn: string | null };

/** The Patients tab list: one row per (unmerged) patient with the derived counts. Search is a name or MRN prefix. */
export async function patientList(q: string, today: string): Promise<PatientListRow[]> {
  const text = q.trim();
  const where = {
    mergedIntoId: null,
    ...(text ? { OR: [{ lastName: { startsWith: text, mode: "insensitive" as const } }, { firstName: { startsWith: text, mode: "insensitive" as const } }, { mrn: { startsWith: text.toUpperCase().replace(/\s+/g, "") } }] } : {}),
  };
  const patients = await db.patient.findMany({ where, orderBy: [{ lastName: "asc" }, { firstName: "asc" }], take: LIMIT, select: { id: true, lastName: true, firstName: true, mrn: true } });
  const ids = patients.map((p) => p.id);
  const [visits] = await Promise.all([
    db.visit.findMany({ where: { ...LIVE_VISITS, patientId: { in: ids } }, select: { legacyScheduleEntryId: true, patientId: true, visitDate: true, status: true, providerName: true, program: true, appointmentType: true } }),
  ]);
  const r = rollup(
    visits.map((v) => ({ patientId: v.patientId, date: v.visitDate, status: v.status, provider: v.providerName, program: v.program, type: v.appointmentType })),
    [],
    today,
  );
  const empty = (id: string): PatientRollup => ({ patientId: id, appointments: 0, seen: 0, absent: 0, missed: 0, canceled: 0, other: 0, upcoming: 0, unmarked: 0, lastSeen: "", lastProvider: "", currentProgram: "", providers: [], visitTypes: [] });
  return patients.map((p) => ({ ...(r.get(p.id) ?? empty(p.id)), name: `${p.lastName}, ${p.firstName}`, mrn: p.mrn }));
}
