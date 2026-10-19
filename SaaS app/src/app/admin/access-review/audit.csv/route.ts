import { NextResponse } from "next/server";
import { db } from "@/lib/db";
import { audit } from "@/lib/audit";
import { auditDenied, getCurrentUser } from "@/lib/session";
import { canOpenAdmin } from "@/lib/access";
import { AUDIT_EXPORT_MAX, auditCsv, auditWhere, describeFilters, parseAuditFilters } from "@/lib/accessReview";

export const runtime = "nodejs";

/** CSV of the audit log for the filters in the query string (newest first, capped). Admin only; audited. */
export async function GET(req: Request) {
  const user = await getCurrentUser();
  if (!user) return NextResponse.json({ error: "Not signed in" }, { status: 401 });
  if (!canOpenAdmin(user)) {
    await auditDenied(user.email, "admin (audit export)");
    return NextResponse.json({ error: "No access" }, { status: 403 });
  }
  const filters = parseAuditFilters(Object.fromEntries(new URL(req.url).searchParams));
  const rows = await db.auditLog.findMany({
    where: auditWhere(filters),
    orderBy: { createdAt: "desc" },
    take: AUDIT_EXPORT_MAX,
    select: { createdAt: true, actorEmail: true, action: true, detail: true },
  });
  await audit(user.email, "audit.export", `${describeFilters(filters)}; ${rows.length} row(s)${rows.length === AUDIT_EXPORT_MAX ? " (capped)" : ""}`);
  return new NextResponse(auditCsv(rows), {
    headers: {
      "Content-Type": "text/csv; charset=utf-8",
      "Content-Disposition": `attachment; filename="audit-log-${new Date().toISOString().slice(0, 10)}.csv"`,
      "Cache-Control": "no-store",
    },
  });
}
