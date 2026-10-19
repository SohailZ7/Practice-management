import { NextResponse } from "next/server";
import { db } from "@/lib/db";
import { audit } from "@/lib/audit";
import { auditDenied, getCurrentUser } from "@/lib/session";
import { canOpenAdmin } from "@/lib/access";
import { buildReviewRows, reviewCsv } from "@/lib/accessReview";

export const runtime = "nodejs";

/** CSV of every user, role, last sign-in, module levels and flags. Admin only; audited. */
export async function GET() {
  const user = await getCurrentUser();
  if (!user) return NextResponse.json({ error: "Not signed in" }, { status: 401 });
  if (!canOpenAdmin(user)) {
    await auditDenied(user.email, "admin (access review export)");
    return NextResponse.json({ error: "No access" }, { status: 403 });
  }
  const [users, employees, viewers] = await Promise.all([
    db.user.findMany({ orderBy: { createdAt: "asc" }, include: { access: true } }),
    db.employee.findMany({ select: { id: true, name: true } }),
    db.taskViewer.findMany({ select: { userId: true, employeeId: true } }),
  ]);
  const names = new Map(employees.map((e) => [e.id, e.name]));
  const rows = buildReviewRows(users, viewers.map((v) => ({ userId: v.userId, employeeName: names.get(v.employeeId) ?? "unknown" })), new Date());
  await audit(user.email, "access_review.export", `${rows.length} user(s)`);
  return new NextResponse(reviewCsv(rows), {
    headers: {
      "Content-Type": "text/csv; charset=utf-8",
      "Content-Disposition": `attachment; filename="access-review-${new Date().toISOString().slice(0, 10)}.csv"`,
      "Cache-Control": "no-store",
    },
  });
}
