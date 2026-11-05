import { NextResponse } from "next/server";
import { db } from "@/lib/db";
import { audit } from "@/lib/audit";
import { auditDenied, getCurrentUser } from "@/lib/session";
import { isMonthKey, monthKey, timesheetAccess, toCsv } from "@/lib/timesheets/calc";

export const runtime = "nodejs";

/** CSV of one employee's month, same columns as the reference sheet. Admin only. */
export async function GET(req: Request) {
  const user = await getCurrentUser();
  if (!user) return NextResponse.json({ error: "Not signed in" }, { status: 401 });
  const q = new URL(req.url).searchParams;
  const emp = await db.timesheetEmployee.findUnique({ where: { id: q.get("e") ?? "" } });
  if (timesheetAccess(user, emp ?? undefined) === "none") {
    await auditDenied(user.email, "timesheets (export)");
    return NextResponse.json({ error: "No access" }, { status: 403 });
  }
  const month = q.get("m") ?? "";
  if (!emp || !isMonthKey(month)) return NextResponse.json({ error: "Choose an employee and month" }, { status: 400 });
  const rows = (await db.timesheetEntry.findMany({ where: { employeeId: emp.id, date: { startsWith: month } } })).filter((r) => monthKey(r.date) === month);
  await audit(user.email, "timesheet.export", `emp ${emp.id} ${month} rows=${rows.length}`);
  const safe = emp.name.replace(/[^A-Za-z0-9]+/g, "-");
  return new NextResponse(toCsv(rows), {
    headers: { "Content-Type": "text/csv; charset=utf-8", "Content-Disposition": `attachment; filename="timesheet-${safe}-${month}.csv"`, "Cache-Control": "no-store" },
  });
}
