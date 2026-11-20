import { db } from "@/lib/db";
import { addDays } from "@/lib/dates";

export type Worklist = { todayVisits: number; overdue: number; needsPatient: number; missingDocs: number; unverifiedDocs: number };

/** Overview worklist: counts only, never names. Overdue = still "scheduled" more than 7 days after its date. */
export async function worklistCounts(today: string): Promise<Worklist> {
  const [todayVisits, overdue, needsPatient, missingDocs, unverifiedDocs] = await Promise.all([
    db.visit.count({ where: { visitDate: today, status: { not: "cancelled" }, NOT: { appointmentType: { contains: "orders only", mode: "insensitive" } } } }),
    db.visit.count({ where: { status: "scheduled", visitDate: { lte: addDays(today, -7) }, NOT: { appointmentType: { contains: "orders only", mode: "insensitive" } } } }),
    db.unmatchedAppointment.count({ where: { date: { gte: addDays(today, -30) } } }),
    db.visit.count({ where: { status: { in: ["seen", "note_signed"] }, visitDate: { gte: addDays(today, -60) }, documents: { none: {} } } }),
    db.visitDocument.count({ where: { draft: true } }),
  ]);
  return { todayVisits, overdue, needsPatient, missingDocs, unverifiedDocs };
}
