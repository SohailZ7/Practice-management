import { db } from "@/lib/db";
import { audit } from "@/lib/audit";
import { isTrackingOnlyName } from "@/lib/notes/trackingOnly";
import { chargeCodeFor, isBillableStatus, type SkipReason } from "./fromVisit";

/**
 * Creates the draft Encounter for a Seen visit and links it (Visit.encounterId). Idempotent: a visit that already has one is
 * left alone. Never throws into the status change: a skip is returned and audited with ids only.
 */
export async function autoEncounterForVisit(actor: { email: string }, visitId: string): Promise<{ created: boolean; encounterId?: string; skipped?: SkipReason }> {
  try {
    const v = await db.visit.findUnique({ where: { id: visitId } });
    if (!v) return { created: false };
    if (v.encounterId) return { created: false, skipped: "already_linked" };
    if (!isBillableStatus(v.status)) return { created: false, skipped: "not_billable_status" };
    if (await isTrackingOnlyName(v.providerName)) return { created: false, skipped: "tracking_only" };
    const program = v.program.trim()
      ? await db.program.findFirst({ where: { name: { equals: v.program.trim(), mode: "insensitive" }, active: true } })
      : null;
    if (!program) {
      await audit(actor.email, "billing.auto.skipped", `visit ${visitId} reason=no_program`);
      return { created: false, skipped: "no_program" };
    }
    const user = await db.user.findUnique({ where: { email: actor.email }, select: { id: true } });
    const createdById = user?.id ?? (await db.user.findFirst({ where: { role: "ADMIN" }, select: { id: true } }))?.id;
    if (!createdById) return { created: false };
    const enc = await db.$transaction(async (tx) => {
      const e = await tx.encounter.create({
        data: { patientId: v.patientId, encounterDate: v.visitDate, programId: program.id, chargeCode: chargeCodeFor(v.appointmentType), createdById },
      });
      await tx.visit.update({ where: { id: v.id }, data: { encounterId: e.id } });
      return e;
    });
    await audit(actor.email, "billing.auto.create", `visit ${visitId} encounter ${enc.id}`);
    return { created: true, encounterId: enc.id };
  } catch {
    return { created: false };
  }
}
