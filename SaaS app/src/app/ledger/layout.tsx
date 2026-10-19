import type { ReactNode } from "react";
import { requireAccess } from "@/lib/session";
import { canAccess } from "@/lib/access";
import { LedgerTabs } from "@/components/ledger/LedgerTabs";

export default async function LedgerLayout({ children }: { children: ReactNode }) {
  const user = await requireAccess("ledger", "view");
  return (
    <>
      <h1>Ledger</h1>
      <LedgerTabs canEdit={canAccess(user, "ledger", "edit")} />
      {children}
    </>
  );
}
