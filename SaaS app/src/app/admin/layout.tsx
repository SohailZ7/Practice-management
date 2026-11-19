import type { ReactNode } from "react";
import { PageHead } from "@/components/PageHead";
import { requireAdmin } from "@/lib/session";
import { isStaging } from "@/lib/promote/rules";
import { AdminTabs } from "@/components/AdminTabs";

export const dynamic = "force-dynamic";

// AUTH-13: every page under /admin is Admin-only; anyone else is sent to the "no access" page.
export default async function AdminLayout({ children }: { children: ReactNode }) {
  await requireAdmin();
  return (
    <>
      <PageHead eyebrow="The right access, for the right people" title="A well-supported team." />
      <AdminTabs showPromote={isStaging()} />
      {children}
    </>
  );
}
