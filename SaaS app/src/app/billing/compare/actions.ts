"use server";

import { db } from "@/lib/db";
import { requireAccess } from "@/lib/session";
import { audit } from "@/lib/audit";
import { compareGetix, nameKey, parseGetixReport, type CompareResult } from "@/lib/billing/getixCompare";

const MAX_CHARS = 2_000_000;

/** Compares a GetIX report (CSV text) with the encounters marked entered in GetIX. Nothing is stored; the audit holds counts only. */
export async function compareReport(text: string): Promise<{ ok: true; result: CompareResult; skipped: number } | { ok: false; error: string }> {
  const user = await requireAccess("billing", "view");
  if (typeof text !== "string" || text.length > MAX_CHARS) return { ok: false, error: "That file is too large. Use a report of up to 2 MB." };
  const parsed = parseGetixReport(text);
  if (parsed.error) return { ok: false, error: parsed.error };
  const dates = parsed.rows.map((r) => r.date).sort();
  const encs = await db.encounter.findMany({
    where: { deletedAt: null, getixEntered: true, encounterDate: { gte: dates[0], lte: dates[dates.length - 1] } },
    include: { patient: true },
  });
  const result = compareGetix(
    parsed.rows,
    encs.map((e) => ({ id: e.id, date: e.encounterDate, key: nameKey(`${e.patient.firstName} ${e.patient.lastName}`), display: `${e.patient.lastName}, ${e.patient.firstName}`, chargeCode: e.chargeCode, incorrect: e.incorrectAt !== null && e.incorrectResolvedAt === null })),
  );
  await audit(user.email, "billing.getix.compare", `rows=${parsed.rows.length} matched=${result.matched} onlyReport=${result.onlyInReport.length} onlyApp=${result.onlyInApp.length}`);
  return { ok: true, result, skipped: parsed.skipped };
}
