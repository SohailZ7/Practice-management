"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";

export function BillingTabs({ canEdit, isAdmin }: { canEdit: boolean; isAdmin: boolean }) {
  const path = usePathname();
  const tabs = [
    { href: "/billing", label: "Encounters", exact: true },
    { href: "/billing/patients", label: "Patients" },
    ...(canEdit ? [{ href: "/billing/new", label: "New encounter" }] : []),
    ...(isAdmin ? [{ href: "/billing/programs", label: "Programs" }] : []),
  ];
  return (
    <div className="tabs" role="tablist" aria-label="Billing">
      {tabs.map((t) => {
        const on = t.exact ? path === t.href : path.startsWith(t.href);
        return (
          <Link key={t.href} href={t.href} role="tab" aria-selected={on} className={on ? "tab on" : "tab"}>
            {t.label}
          </Link>
        );
      })}
    </div>
  );
}
