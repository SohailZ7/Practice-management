import Link from "next/link";
import { requireAccess } from "@/lib/session";
import { canAccess } from "@/lib/access";
import { audit } from "@/lib/audit";
import { REPORTS, buildReport, redact } from "@/lib/reports/build";
import { cleanRange, loadReportVisits, ownProviderName } from "@/lib/reports/load";
import { practiceToday } from "@/lib/notes/rowColor";

// Reports: its own menu item. Needs Billing view; names show only with Patients (notes) view; a non-admin sees their own provider's visits only.
export default async function Reports({ searchParams }: { searchParams: { r?: string; from?: string; to?: string } }) {
  const user = await requireAccess("billing", "view");
  const def = REPORTS.find((r) => r.id === searchParams.r) ?? REPORTS[0];
  const { from, to } = cleanRange(searchParams.from, searchParams.to);
  const admin = user.role === "ADMIN";
  const own = admin ? null : (await ownProviderName(user.email)) ?? "\u0000none";
  const { visits, capped } = await loadReportVisits({ from, to, providerOnly: own });
  const names = canAccess(user, "notes", "view");
  let tables = buildReport(def.id, visits, { today: practiceToday() });
  if (!names) tables = redact(tables);
  await audit(user.email, "reports.view", `${def.id} rows=${visits.length}`);
  const q = (id: string) => `/reports?r=${id}${from ? `&from=${from}` : ""}${to ? `&to=${to}` : ""}`;
  const exp = (red: boolean) => `/reports/export?r=${def.id}${from ? `&from=${from}` : ""}${to ? `&to=${to}` : ""}${red ? "&redacted=1" : ""}`;
  return (
    <>
      <div className="page-head">
        <div className="page-head-text">
          <p className="page-eyebrow">Clinical</p>
          <h1>Reports</h1>
          <p className="muted">{def.blurb}</p>
        </div>
      </div>
      <div className="tabs" role="tablist" aria-label="Reports" style={{ flexWrap: "wrap" }}>
        {REPORTS.map((r) => <Link key={r.id} href={q(r.id)} role="tab" aria-selected={r.id === def.id} className={r.id === def.id ? "tab on" : "tab"}>{r.label}</Link>)}
      </div>
      <form method="get" className="row" style={{ margin: ".75rem 0" }}>
        <input type="hidden" name="r" value={def.id} />
        <label>From <input type="date" name="from" defaultValue={from} /></label>
        <label>To <input type="date" name="to" defaultValue={to} /></label>
        <button type="submit" className="secondary">Apply</button>
        <span className="grow" />
        {names && <a className="btn secondary" href={exp(false)}>Export CSV</a>}
        <a className="btn secondary" href={exp(true)}>Export CSV (no names)</a>
      </form>
      {!admin && <p className="small muted">You see your own provider&apos;s visits only.</p>}
      {capped && <p className="small muted" role="status">Showing the first 5,000 visits. Narrow the dates for the rest.</p>}
      {tables.map((t) => (
        <section key={t.title} style={{ marginBottom: "1.25rem" }}>
          <h2 style={{ fontSize: "1.05rem" }}>{t.title} <span className="muted small">{t.rows.length}</span></h2>
          {t.rows.length === 0 ? <p className="muted">Nothing in this range.</p> : (
            <div style={{ overflowX: "auto" }}>
              <table>
                <thead><tr>{t.columns.map((c) => <th key={c.key}>{c.label}</th>)}</tr></thead>
                <tbody>{t.rows.map((r, i) => <tr key={i}>{r.map((c, j) => <td key={j}>{c}</td>)}</tr>)}</tbody>
              </table>
            </div>
          )}
        </section>
      ))}
    </>
  );
}
