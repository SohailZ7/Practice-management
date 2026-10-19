import { db } from "@/lib/db";
import { requireAccess } from "@/lib/session";
import { isISODate, todayISO } from "@/lib/dates";
import { formatMoney } from "@/lib/ledger/money";
import { byCategory, byMonth } from "@/lib/ledger/summary";
import { ledgerTotals } from "@/lib/ledger/validate";

export default async function LedgerSummary({ searchParams }: { searchParams: { from?: string; to?: string } }) {
  await requireAccess("ledger", "view");
  const year = todayISO().slice(0, 4);
  const from = searchParams.from && isISODate(searchParams.from) ? searchParams.from : `${year}-01-01`;
  const to = searchParams.to && isISODate(searchParams.to) ? searchParams.to : "";

  const [rows, categories] = await Promise.all([
    db.ledgerEntry.findMany({
      where: { date: { gte: from, ...(to ? { lte: to } : {}) } },
      select: { date: true, cashIn: true, cashOut: true, categoryId: true },
    }),
    db.ledgerCategory.findMany({ select: { id: true, name: true } }),
  ]);
  const name = new Map(categories.map((c) => [c.id, c.name]));
  const totals = ledgerTotals(rows);
  const money = (n: number) => (n ? formatMoney(n) : "-");

  return (
    <>
      <form method="get" className="card row">
        <label className="check">
          From <input type="date" name="from" defaultValue={from} />
        </label>
        <label className="check">
          To <input type="date" name="to" defaultValue={to} />
        </label>
        <button type="submit">Apply</button>
        <span className="muted small">Dates are not part of any patient data, so they can be in the address.</span>
      </form>

      <div className="stat-row">
        <div className="stat">
          <span className="muted small">Cash in</span>
          <strong className="pos">{formatMoney(totals.cashIn)}</strong>
        </div>
        <div className="stat">
          <span className="muted small">Cash out</span>
          <strong className="neg">{formatMoney(totals.cashOut)}</strong>
        </div>
        <div className="stat">
          <span className="muted small">Net</span>
          <strong className={totals.net < 0 ? "neg" : "pos"}>{formatMoney(totals.net)}</strong>
        </div>
        <div className="stat">
          <span className="muted small">Entries</span>
          <strong>{totals.count}</strong>
        </div>
      </div>

      <h2>By category</h2>
      <div className="table-wrap">
        <table>
          <thead>
            <tr>
              <th>Category</th>
              <th className="r">Cash in</th>
              <th className="r">Cash out</th>
              <th className="r">Net</th>
              <th className="r">Entries</th>
            </tr>
          </thead>
          <tbody>
            {byCategory(rows).map((b) => (
              <tr key={b.key || "none"}>
                <td>{b.key ? (name.get(b.key) ?? "Removed category") : "(No category)"}</td>
                <td className="r">{money(b.cashIn)}</td>
                <td className="r">{money(b.cashOut)}</td>
                <td className="r">{formatMoney(b.net)}</td>
                <td className="r">{b.count}</td>
              </tr>
            ))}
            {rows.length === 0 && (
              <tr>
                <td colSpan={5} className="muted">
                  No entries in this range.
                </td>
              </tr>
            )}
          </tbody>
        </table>
      </div>

      <h2>By month</h2>
      <div className="table-wrap">
        <table>
          <thead>
            <tr>
              <th>Month</th>
              <th className="r">Cash in</th>
              <th className="r">Cash out</th>
              <th className="r">Net</th>
              <th className="r">Entries</th>
            </tr>
          </thead>
          <tbody>
            {byMonth(rows).map((b) => (
              <tr key={b.key}>
                <td>{b.key}</td>
                <td className="r">{money(b.cashIn)}</td>
                <td className="r">{money(b.cashOut)}</td>
                <td className="r">{formatMoney(b.net)}</td>
                <td className="r">{b.count}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </>
  );
}
