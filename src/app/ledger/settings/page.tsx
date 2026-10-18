import { requireAccess } from "@/lib/session";
import { ledgerOptions } from "@/lib/ledger/queries";
import { OptionManager } from "@/components/ledger/OptionManager";

export default async function LedgerListsPage() {
  await requireAccess("ledger", "edit");
  const { categories, methods, parties } = await ledgerOptions();
  return (
    <>
      <OptionManager kind="category" title="Categories" hint="The Category dropdown in the ledger." options={categories} />
      <OptionManager kind="method" title="Methods" hint="How the money moved: cash, check, Zelle, card…" options={methods} />
      <OptionManager kind="party" title="Transaction by" hint="Who made the transaction." options={parties} />
    </>
  );
}
