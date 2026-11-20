import { db } from "../db";
import { chargeCodeFor } from "../billing/fromVisit";
import type { ReportVisit } from "./build";

const ISO = /^\d{4}-\d{2}-\d{2}$/;
export const cleanRange = (from: unknown, to: unknown) => ({ from: typeof from === "string" && ISO.test(from) ? from : "", to: typeof to === "string" && ISO.test(to) ? to : "" });

/** Date (practice time zone) the last document was finalized, when every document is final and dated; else "". */
function doneDate(docs: { draft: boolean; finalizedAt: Date | null }[]): string {
  if (docs.length === 0 || docs.some((d) => d.draft || !d.finalizedAt)) return "";
  const last = Math.max(...docs.map((d) => d.finalizedAt!.getTime()));
  return new Date(last).toLocaleDateString("en-CA", { timeZone: "America/Los_Angeles" });
}

/** Visits in [from, to] (blank = all, capped at 5000) as report rows. `providerOnly` limits a non-admin to their own provider's visits. */
export async function loadReportVisits(f: { from: string; to: string; providerOnly: string | null }): Promise<{ visits: ReportVisit[]; capped: boolean }> {
  const where = {
    ...(f.from || f.to ? { visitDate: { ...(f.from ? { gte: f.from } : {}), ...(f.to ? { lte: f.to } : {}) } } : {}),
    ...(f.providerOnly !== null ? { providerName: { equals: f.providerOnly, mode: "insensitive" as const } } : {}),
  };
  const [rows, tracking] = await Promise.all([
    db.visit.findMany({
      where, orderBy: { visitDate: "asc" }, take: 5001,
      select: { id: true, visitDate: true, apptTime: true, status: true, program: true, appointmentType: true, providerName: true, patientId: true, encounter: { select: { chargeCode: true, getixEntered: true, deletedAt: true } }, patient: { select: { firstName: true, lastName: true } }, documents: { select: { draft: true, finalizedAt: true } } },
    }),
    db.provider.findMany({ where: { trackingOnly: true }, select: { name: true } }),
  ]);
  const trackSet = new Set(tracking.map((t) => t.name.trim().toLowerCase()));
  const capped = rows.length > 5000;
  const visits = rows.slice(0, 5000).map((r): ReportVisit => {
    const enc = r.encounter && !r.encounter.deletedAt ? r.encounter : null;
    const code = enc?.chargeCode || chargeCodeFor(r.appointmentType);
    return {
      id: r.id, date: r.visitDate, time: r.apptTime, status: r.status, program: r.program, type: r.appointmentType, provider: r.providerName,
      trackingOnly: trackSet.has(r.providerName.trim().toLowerCase()), patientId: r.patientId, patientName: `${r.patient.lastName}, ${r.patient.firstName}`,
      chargeCode: code, billed: !!enc && (enc.getixEntered || code.toUpperCase() === "NB DC"), hasEncounter: !!enc, docCount: r.documents.length, docDraft: r.documents.some((d) => d.draft), docDoneDate: doneDate(r.documents),
    };
  });
  return { visits, capped };
}

/** The provider name tied to this login (Employee email), for scoping a non-admin's reports. */
export async function ownProviderName(email: string): Promise<string | null> {
  return (await db.provider.findFirst({ where: { employee: { email } }, select: { name: true } }))?.name ?? null;
}
