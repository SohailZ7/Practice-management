import { requireAccess } from "@/lib/session";
import { canAccess } from "@/lib/access";
import { todayISO } from "@/lib/dates";
import { defaultLedgerFilters, ledgerOptions, queryLedger } from "@/lib/ledger/queries";
import { LedgerGrid } from "@/components/ledger/LedgerGrid";

export default async function LedgerPage() {
  const user = await requireAccess("ledger", "view");
  const today = todayISO();
  const filters = defaultLedgerFilters(today);
  const [rows, options] = await Promise.all([queryLedger(filters), ledgerOptions()]);
  return (
    <LedgerGrid
      initialRows={rows}
      initialFilters={filters}
      categories={options.categories}
      methods={options.methods}
      parties={options.parties}
      canEdit={canAccess(user, "ledger", "edit")}
      today={today}
    />
  );
}
