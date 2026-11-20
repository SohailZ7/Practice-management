import { db } from "@/lib/db";
import { requireAccess } from "@/lib/session";
import { canAccess } from "@/lib/access";
import { audit } from "@/lib/audit";
import { FilesPanel } from "@/components/billing/FilesPanel";

export default async function BillingFiles() {
  const user = await requireAccess("billing", "view");
  const rows = await db.billingFile.findMany({ orderBy: { createdAt: "desc" }, take: 200, select: { id: true, name: true, size: true, note: true, uploadedByEmail: true, createdAt: true } });
  await audit(user.email, "billing.files.view", `${rows.length} file(s)`);
  return <FilesPanel canEdit={canAccess(user, "billing", "edit")} isAdmin={user.role === "ADMIN"} rows={rows.map((r) => ({ ...r, createdAt: r.createdAt.toISOString().slice(0, 10) }))} />;
}
