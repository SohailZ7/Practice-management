"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";

export function LedgerTabs({ canEdit }: { canEdit: boolean }) {
  const path = usePathname();
  const tabs = [
    { href: "/ledger", label: "Ledger", exact: true },
    { href: "/ledger/summary", label: "Summary" },
    ...(canEdit ? [{ href: "/ledger/settings", label: "Lists" }] : []),
  ];
  return (
    <div className="tabs" role="tablist" aria-label="Ledger">
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
