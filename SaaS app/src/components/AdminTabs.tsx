"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { ADMIN_PAGES, adminPageActive } from "@/lib/adminNav";

export function AdminTabs() {
  const path = usePathname();
  return (
    <div className="tabs" role="tablist" aria-label="Admin console">
      {ADMIN_PAGES.map((p) => {
        const on = adminPageActive(path, p.href);
        return (
          <Link key={p.href} href={p.href} role="tab" aria-selected={on} className={on ? "tab on" : "tab"}>
            {p.label}
          </Link>
        );
      })}
    </div>
  );
}
