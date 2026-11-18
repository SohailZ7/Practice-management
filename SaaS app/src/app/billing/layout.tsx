import type { ReactNode } from "react";
import { requireAccess } from "@/lib/session";
import { canAccess } from "@/lib/access";
import { BillingTabs } from "@/components/billing/BillingTabs";

export default async function BillingLayout({ children }: { children: ReactNode }) {
  const user = await requireAccess("billing", "view");
  return (
    <>
      <p className="page-eyebrow">{new Date().toLocaleString("en-US", { month: "long", year: "numeric" })}</p>
      <h1>Billing</h1>
      <BillingTabs canEdit={canAccess(user, "billing", "edit")} isAdmin={user.role === "ADMIN"} />
      {children}
    </>
  );
}
