import { NextResponse } from "next/server";
import { requireAccess } from "@/lib/session";
import { canAccess } from "@/lib/access";
import { audit } from "@/lib/audit";
import { REPORTS, buildReport, redact, toCsv } from "@/lib/reports/build";
import { cleanRange, loadReportVisits, ownProviderName } from "@/lib/reports/load";
import { practiceToday } from "@/lib/notes/rowColor";

// GET /reports/export?r=&from=&to=&redacted=1 . Needs Billing view. Without Patients view, or with redacted=1, no name column is written.
export async function GET(req: Request) {
  const user = await requireAccess("billing", "view");
  const u = new URL(req.url);
  const def = REPORTS.find((r) => r.id === u.searchParams.get("r")) ?? REPORTS[0];
  const { from, to } = cleanRange(u.searchParams.get("from"), u.searchParams.get("to"));
  const own = user.role === "ADMIN" ? null : (await ownProviderName(user.email)) ?? "\u0000none";
  const { visits } = await loadReportVisits({ from, to, providerOnly: own });
  const red = u.searchParams.get("redacted") === "1" || !canAccess(user, "notes", "view");
  let tables = buildReport(def.id, visits, { today: practiceToday() });
  if (red) tables = redact(tables);
  await audit(user.email, "reports.export", `${def.id} rows=${visits.length} redacted=${red}`);
  return new NextResponse(toCsv(tables), { headers: { "content-type": "text/csv; charset=utf-8", "content-disposition": `attachment; filename="report-${def.id}${red ? "-redacted" : ""}.csv"`, "cache-control": "no-store" } });
}
