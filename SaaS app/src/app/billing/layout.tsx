import Link from "next/link";
import type { ReactNode } from "react";
import { requireAccess } from "@/lib/session";
import { canAccess } from "@/lib/access";
import { BillingTabs } from "@/components/billing/BillingTabs";

export default async function BillingLayout({ children }: { children: ReactNode }) {
  const user = await requireAccess("billing", "view");
  return (
    <>
      <div className="page-head">
        <div className="page-head-text">
          <p className="page-eyebrow">From care to completion</p>
          <h1>Nothing falls through the cracks.</h1>
        </div>
        {canAccess(user, "billing", "edit") && (
          <Link className="btn" href="/billing/new">
            New encounter
          </Link>
        )}
      </div>
      <BillingTabs canEdit={canAccess(user, "billing", "edit")} isAdmin={user.role === "ADMIN"} />
      {children}
    </>
  );
}
