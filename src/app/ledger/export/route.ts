import { NextResponse } from "next/server";
import { db } from "@/lib/db";
import { audit } from "@/lib/audit";
import { auditDenied, getCurrentUser } from "@/lib/session";
import { canAccess } from "@/lib/access";
import { isISODate } from "@/lib/dates";
import { ledgerWhere, defaultLedgerFilters } from "@/lib/ledger/queries";
import { csvField } from "@/lib/ledger/validate";
import type { LedgerFilters } from "@/lib/ledger/types";

export const runtime = "nodejs";

const cents = (n: number) => (n ? (n / 100).toFixed(2) : "");

/** CSV of the ledger for the filters in the query string. Needs view access to Ledger. */
export async function GET(req: Request) {
  const user = await getCurrentUser();
  if (!user) return NextResponse.json({ error: "Not signed in" }, { status: 401 });
  if (!canAccess(user, "ledger", "view")) {
    await auditDenied(user.email, "ledger:view (export)");
    return NextResponse.json({ error: "No access" }, { status: 403 });
  }

  const q = new URL(req.url).searchParams;
  const get = (k: string) => q.get(k) ?? "";
  const base = defaultLedgerFilters();
  const date = (k: string) => (isISODate(get(k)) ? get(k) : "");
  const type = get("type");
  const filters: LedgerFilters = {
    ...base,
    from: q.has("from") ? date("from") : "",
    to: date("to"),
    categoryId: get("categoryId"),
    methodId: get("methodId"),
    partyId: get("partyId"),
    type: type === "in" || type === "out" ? type : "all",
    q: get("q").slice(0, 100),
  };

  const [rows, cats, methods, parties] = await Promise.all([
    db.ledgerEntry.findMany({ where: ledgerWhere(filters), orderBy: [{ date: "asc" }, { createdAt: "asc" }] }),
    db.ledgerCategory.findMany(),
    db.ledgerMethod.findMany(),
    db.ledgerParty.findMany(),
  ]);
  const name = (list: { id: string; name: string }[], id: string | null) => list.find((x) => x.id === id)?.name ?? "";

  const lines = [["Date", "Cash In", "Cash Out", "Transaction By", "Category", "Method", "Comments"].join(",")];
  for (const r of rows) {
    lines.push(
      [
        r.date,
        cents(r.cashIn),
        cents(r.cashOut),
        csvField(name(parties, r.partyId)),
        csvField(name(cats, r.categoryId)),
        csvField(name(methods, r.methodId)),
        csvField(r.comments),
      ].join(","),
    );
  }
  await audit(user.email, "export.csv", `ledger: ${rows.length} row(s)`);
  return new NextResponse(lines.join("\r\n") + "\r\n", {
    headers: {
      "Content-Type": "text/csv; charset=utf-8",
      "Content-Disposition": 'attachment; filename="ledger.csv"',
      "Cache-Control": "no-store",
    },
  });
}
