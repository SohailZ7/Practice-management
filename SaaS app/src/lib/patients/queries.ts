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
  const [visits, entries] = await Promise.all([
    db.visit.findMany({ where: { ...LIVE_VISITS, patientId: { in: ids } }, select: { legacyScheduleEntryId: true, patientId: true, visitDate: true, status: true, providerName: true, program: true, appointmentType: true } }),
    db.scheduleEntry.findMany({ where: { patientId: { in: ids }, visitId: null }, select: { id: true, patientId: true, date: true, completed: true, absent: true, canceled: true, missed: true, providerName: true, trackName: true, typeName: true } }),
  ]);
  const legacy = new Set(visits.map((v) => v.legacyScheduleEntryId).filter((x): x is string => !!x));
  const r = rollup(
    visits.map((v) => ({ patientId: v.patientId, date: v.visitDate, status: v.status, provider: v.providerName, program: v.program, type: v.appointmentType })),
    // Release B1: a schedule row that a Visit already carries (backfilled) is that Visit, never a second appointment.
    entries.filter((e) => !legacy.has(e.id)).map((e) => ({ patientId: e.patientId as string, date: e.date, completed: e.completed, absent: e.absent, canceled: e.canceled, missed: e.missed, provider: e.providerName, program: e.trackName, type: e.typeName })),
    today,
  );
  const empty = (id: string): PatientRollup => ({ patientId: id, appointments: 0, seen: 0, absent: 0, missed: 0, canceled: 0, other: 0, upcoming: 0, unmarked: 0, lastSeen: "", lastProvider: "", currentProgram: "", providers: [], visitTypes: [] });
  return patients.map((p) => ({ ...(r.get(p.id) ?? empty(p.id)), name: `${p.lastName}, ${p.firstName}`, mrn: p.mrn }));
}
