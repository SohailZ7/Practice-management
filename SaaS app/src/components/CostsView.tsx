import { priorMonth, usd, type EnvSummary } from "@/lib/costs";

function delta(cur: number, prior: number): string {
  if (!prior) return cur ? "new" : "";
  const p = ((cur - prior) / prior) * 100;
  return `${p >= 0 ? "+" : ""}${p.toFixed(0)}%`;
}

export function EnvCard({ name, s, month }: { name: string; s: EnvSummary; month: string }) {
  const max = Math.max(1, ...s.byCategory.map((c) => c.amount));
  return (
    <section className="cost-card" aria-label={`${name} costs`}>
      <h2>{name}</h2>
      <p className="cost-total">{usd(s.total)} <span className="muted">in {month}</span></p>
      <p className="muted">{priorMonth(month)}: {usd(s.priorTotal)} {s.priorTotal || s.total ? `(${delta(s.total, s.priorTotal)})` : ""}</p>
      {!s.hasRows ? <p className="muted">No billing rows for this month.</p> : null}
      <table className="cost-table">
        <thead><tr><th>Service</th><th className="num">{month}</th><th className="num">Prior</th><th className="num">Change</th></tr></thead>
        <tbody>
          {s.byCategory.map((c) => (
            <tr key={c.category}>
              <td>{c.category}<span className="cost-bar" style={{ width: `${(c.amount / max) * 100}%` }} aria-hidden="true" /></td>
              <td className="num">{usd(c.amount)}</td>
              <td className="num">{usd(c.prior)}</td>
              <td className="num">{delta(c.amount, c.prior)}</td>
            </tr>
          ))}
        </tbody>
      </table>
      {s.vertexSkus.length ? (
        <>
          <h3>Vertex AI by SKU</h3>
          <table className="cost-table">
            <tbody>{s.vertexSkus.map((k) => <tr key={k.sku}><td>{k.sku}</td><td className="num">{usd(k.amount)}</td></tr>)}</tbody>
          </table>
        </>
      ) : null}
    </section>
  );
}

