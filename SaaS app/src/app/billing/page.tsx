import { db } from "@/lib/db";
import { requireAccess } from "@/lib/session";
import { audit } from "@/lib/audit";
import { canAccess } from "@/lib/access";
import { defaultEncounterFilters, queryEncounters } from "@/lib/billing/queries";
import { isAdmin } from "@/lib/billing/rules";
import { EncounterList } from "@/components/billing/EncounterList";

export default async function BillingHome() {
  const user = await requireAccess("billing", "view");
  const filters = defaultEncounterFilters(user);
  const [rows, programs, people] = await Promise.all([
    queryEncounters(user, filters),
    db.program.findMany({ orderBy: { name: "asc" }, select: { id: true, name: true } }),
    isAdmin(user)
      ? db.user.findMany({ orderBy: { name: "asc" }, select: { id: true, name: true } })
      : Promise.resolve([]),
  ]);
  await audit(user.email, "billing.encounters.list", `${rows.length} row(s) (page load)`);
  return (
    <EncounterList
      initialRows={rows}
      initialFilters={filters}
      programs={programs}
      people={people}
      isAdmin={isAdmin(user)}
      canEdit={canAccess(user, "billing", "edit")}
    />
  );
}
