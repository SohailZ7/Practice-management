"use client";

import { useState } from "react";
import { compareReport } from "@/app/billing/compare/actions";
import type { CompareResult } from "@/lib/billing/getixCompare";

export function CompareForm() {
  const [res, setRes] = useState<{ result: CompareResult; skipped: number } | null>(null);
  const [err, setErr] = useState("");
  const [busy, setBusy] = useState(false);
  const onFile = async (f: File | undefined) => {
    if (!f) return;
    setBusy(true); setErr(""); setRes(null);
    try {
      const r = await compareReport(await f.text());
      if (r.ok) setRes({ result: r.result, skipped: r.skipped }); else setErr(r.error);
    } catch { setErr("The comparison failed. Try again."); } finally { setBusy(false); }
  };
  const r = res?.result;
  return (
    <div className="card">
      <h2 style={{ marginTop: 0 }}>GetIX compare</h2>
      <p className="small muted">Upload a GetIX report as CSV (columns: a date, and a patient or first/last name; a charge code is optional). It is matched by date and patient against encounters marked entered in GetIX. The file is not stored.</p>
      <input type="file" accept=".csv,.txt,text/csv" disabled={busy} onChange={(e) => void onFile(e.target.files?.[0])} aria-label="GetIX report CSV" />
      {busy && <p className="muted small">Comparing…</p>}
      {err && <div className="error" role="alert">{err}</div>}
      {r && (
        <>
          <p><b>{r.matched}</b> matched, <b>{r.onlyInReport.length}</b> only in GetIX, <b>{r.onlyInApp.length}</b> only here, <b>{r.incorrectStillInReport.length}</b> flagged incorrect but still in GetIX. Dates {r.from} to {r.to}.{res!.skipped ? ` ${res!.skipped} report row(s) skipped (no date or patient).` : ""}</p>
          <Section title="In GetIX, no encounter here" rows={r.onlyInReport.map((x) => `${x.date}  ${x.display}${x.chargeCode ? `  ${x.chargeCode}` : ""}`)} />
          <Section title="Marked entered here, not in the GetIX report" rows={r.onlyInApp.map((x) => `${x.date}  ${x.display}${x.chargeCode ? `  ${x.chargeCode}` : ""}`)} />
          <Section title="Flagged incorrect, still in GetIX (delete there)" rows={r.incorrectStillInReport.map((x) => `${x.date}  ${x.display}  ${x.chargeCode}`)} />
        </>
      )}
    </div>
  );
}

function Section({ title, rows }: { title: string; rows: string[] }) {
  return (
    <section>
      <h3>{title} <span className="muted small">{rows.length}</span></h3>
      {rows.length === 0 ? <p className="muted small">None.</p> : <ul className="small" style={{ whiteSpace: "pre" }}>{rows.map((x, i) => <li key={i}>{x}</li>)}</ul>}
    </section>
  );
}
