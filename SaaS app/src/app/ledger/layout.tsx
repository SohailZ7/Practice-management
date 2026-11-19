import type { ReactNode } from "react";
import { PageHead } from "@/components/PageHead";
import { requireAccess } from "@/lib/session";
import { canAccess } from "@/lib/access";
import { LedgerTabs } from "@/components/ledger/LedgerTabs";

export default async function LedgerLayout({ children }: { children: ReactNode }) {
  const user = await requireAccess("ledger", "view");
  return (
    <>
      <PageHead eyebrow="A healthy practice, at a glance" title="A clearer picture of your business." />
      <LedgerTabs canEdit={canAccess(user, "ledger", "edit")} />
      {children}
    </>
  );
}
