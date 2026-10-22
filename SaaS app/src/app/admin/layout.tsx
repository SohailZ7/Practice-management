import type { ReactNode } from "react";
import { requireAdmin } from "@/lib/session";
import { AdminTabs } from "@/components/AdminTabs";

export const dynamic = "force-dynamic";

// AUTH-13: every page under /admin is Admin-only; anyone else is sent to the "no access" page.
export default async function AdminLayout({ children }: { children: ReactNode }) {
  await requireAdmin();
  return (
    <>
      <h1>Admin console</h1>
      <AdminTabs />
      {children}
    </>
  );
}
