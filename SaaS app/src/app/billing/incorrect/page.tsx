import { db } from "@/lib/db";
import { requireAdmin } from "@/lib/session";
import { audit } from "@/lib/audit";
import { IncorrectList } from "@/components/billing/IncorrectList";

// Incorrect Billing bucket (admin): encounters flagged as billed wrongly, with the action needed, until marked complete.
export default async function IncorrectBilling() {
  const admin = await requireAdmin();
  const rows = await db.encounter.findMany({
    where: { incorrectAt: { not: null } },
    include: { patient: true, program: true },
    orderBy: [{ incorrectResolvedAt: { sort: "asc", nulls: "first" } }, { incorrectAt: "desc" }],
    take: 300,
  });
  await audit(admin.email, "billing.incorrect.view", `${rows.length} row(s)`);
  return (
    <IncorrectList
      rows={rows.map((e) => ({
        id: e.id,
        patient: `${e.patient.lastName}, ${e.patient.firstName}`,
        date: e.encounterDate,
        client: e.program.name,
        chargeCode: e.chargeCode,
        note: e.incorrectNote,
        action: e.deletedAt ? "Deleted here; delete it in GetIX if it was entered" : "Delete this encounter (and in GetIX if entered)",
        deleted: e.deletedAt !== null,
        complete: e.incorrectResolvedAt !== null,
      }))}
    />
  );
}
