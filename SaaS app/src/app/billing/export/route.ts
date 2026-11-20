import { NextResponse } from "next/server";
import { db } from "@/lib/db";
import { requireAccess } from "@/lib/session";
import { audit } from "@/lib/audit";
import { stageOf } from "@/lib/billing/stage";

// Redacted charge data: no patient names, no MRNs. One row per encounter. Needs Billing view; GET /billing/export?from=&to=
const csv = (v: string) => (/[",\n]/.test(v) ? `"${v.replace(/"/g, '""')}"` : v);
export async function GET(req: Request) {
  const user = await requireAccess("billing", "view");
  const u = new URL(req.url);
  const from = u.searchParams.get("from") ?? "";
  const to = u.searchParams.get("to") ?? "";
  const iso = /^\d{4}-\d{2}-\d{2}$/;
  const rows = await db.encounter.findMany({
    where: { deletedAt: null, ...(user.role === "ADMIN" ? {} : { createdById: user.id }), ...(iso.test(from) ? { encounterDate: { gte: from, ...(iso.test(to) ? { lte: to } : {}) } } : iso.test(to) ? { encounterDate: { lte: to } } : {}) },
    include: { program: true },
    orderBy: [{ encounterDate: "asc" }, { createdAt: "asc" }],
    take: 5000,
  });
  await audit(user.email, "billing.export.redacted", `${rows.length} row(s)`);
  const head = "encounter_date,program,charge_code,icd10,stage";
  const body = rows.map((e) => [e.encounterDate, e.program.name, e.chargeCode, e.icd10Codes.join(" "), stageOf(e)].map(csv).join(","));
  return new NextResponse([head, ...body].join("\n") + "\n", { headers: { "content-type": "text/csv; charset=utf-8", "content-disposition": 'attachment; filename="charges-redacted.csv"', "cache-control": "no-store" } });
}
