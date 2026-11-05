"use client";

import { useState, useTransition } from "react";
import type { ImportReport } from "@/lib/timesheets/importService";
import type { DateFix } from "@/lib/timesheets/importer";
import { monthLabel } from "@/lib/timesheets/calc";

type Actions = {
  preview: (text: string, fixes: DateFix[]) => Promise<ImportReport>;
  confirm: (text: string, fixes: DateFix[]) => Promise<ImportReport>;
};

type Fix = { date: string; skip: boolean };

/** Upload a prepared timesheet JSON file, review what it would do (nothing is saved yet), then confirm. Re-uploading adds nothing twice. */
export function TimesheetImport({ actions }: { actions: Actions }) {
  const [text, setText] = useState("");
  const [name, setName] = useState("");
  const [report, setReport] = useState<ImportReport | null>(null);
  const [fixes, setFixes] = useState<Record<string, Fix>>({});
  const [done, setDone] = useState(false);
  const [pending, start] = useTransition();

  const key = (e: string, i: number) => `${e}|${i}`;
  const fixList = (): DateFix[] => Object.entries(fixes).map(([k, f]) => {
    const [employee, index] = [k.slice(0, k.lastIndexOf("|")), Number(k.slice(k.lastIndexOf("|") + 1))];
    return f.skip ? { employee, index, skip: true } : { employee, index, date: f.date };
  });

  const run = (kind: "preview" | "confirm", body = text, f = fixList()) =>
    start(async () => {
      const r = await actions[kind](body, f);
      setReport(r);
      setDone(kind === "confirm" && r.applied);
    });

  const onFile = async (file: File | undefined) => {
    setDone(false);
    setFixes({});
    setReport(null);
    if (!file) return;
    const body = await file.text();
    setText(body);
    setName(file.name);
    run("preview", body, []);
  };

  const open = report?.needsDate.filter((n) => { const f = fixes[key(n.employee, n.index)]; return !f || (!f.skip && !f.date); }) ?? [];
  const adds = report ? report.entries.reduce((s, r) => s + r.add, 0) + report.payments.reduce((s, r) => s + r.add, 0) : 0;
  const canConfirm = !!report && !report.fatal && !report.errors.length && open.length === 0 && !done && !pending;

  return (
    <details className="card">
      <summary><strong>Import from a file</strong></summary>
      <p className="muted small">
        Admin only. Choose the prepared timesheet file (.json). Nothing is saved until you press Confirm. Uploading the same file again adds nothing twice.
        Each payment in the file also creates its Payroll entry in the Ledger.
      </p>
      <input type="file" accept="application/json,.json" aria-label="Timesheet file" onChange={(e) => onFile(e.target.files?.[0])} />
      {pending && <p className="muted small">Working…</p>}
      {report?.fatal && <div className="error">{report.fatal}</div>}
      {report && !report.fatal && (
        <div className="small" style={{ marginTop: ".5rem" }}>
          <p><strong>{done ? "Imported" : "Preview"}</strong> {name && `(${name})`}</p>
          <table>
            <thead><tr><th>Employee</th><th>Month</th><th>{done ? "Added" : "Will add"}</th><th>Already there</th></tr></thead>
            <tbody>
              {report.entries.map((r) => (
                <tr key={`${r.employee}${r.month}`}><td>{r.employee}</td><td>{monthLabel(r.month)}</td><td>{r.add}</td><td>{r.present}</td></tr>
              ))}
              {report.payments.filter((p) => p.add || p.present).map((r) => (
                <tr key={`pay${r.employee}`}><td>{r.employee}</td><td>Payments</td><td>{r.add}</td><td>{r.present}</td></tr>
              ))}
            </tbody>
          </table>
          {report.needsDate.length > 0 && (
            <div className="card" style={{ marginTop: ".5rem" }}>
              <strong>Needs a date ({report.needsDate.length})</strong>
              <p className="muted">These rows have no date. Enter one, or skip the row. Then press Preview again to recount.</p>
              {report.needsDate.map((n) => {
                const k = key(n.employee, n.index);
                const f = fixes[k] ?? { date: "", skip: false };
                return (
                  <div key={k} className="row">
                    <span>{n.employee}: {n.start} to {n.end}, ${n.rate.replace("$", "")}/hr</span>
                    <input type="date" value={f.date} disabled={f.skip} aria-label="Date for this row" onChange={(e) => setFixes({ ...fixes, [k]: { ...f, date: e.target.value } })} />
                    <label><input type="checkbox" checked={f.skip} onChange={(e) => setFixes({ ...fixes, [k]: { ...f, skip: e.target.checked } })} /> Skip this row</label>
                  </div>
                );
              })}
              <button type="button" className="secondary" disabled={pending} onClick={() => run("preview")}>Preview again</button>
            </div>
          )}
          {report.skippedByAdmin > 0 && <p>Rows you chose to skip: {report.skippedByAdmin}</p>}
          <p>Differences between the file&apos;s own minutes or charge and the computed ones: <strong>{report.discrepancies.length}</strong></p>
          {report.discrepancies.map((d, i) => (
            <div key={i} className="muted">{d.employee} {d.date} {d.start}-{d.end}: {d.field} computed {d.computed}, file {d.sheet}</div>
          ))}
          {report.errors.length > 0 && (
            <div className="error">{report.errors.map((e, i) => <div key={i}>{e}</div>)}</div>
          )}
          {!done && (
            <button type="button" disabled={!canConfirm} onClick={() => run("confirm")} style={{ marginTop: ".5rem" }}>
              Confirm import{adds ? ` (${adds} new)` : ""}
            </button>
          )}
          {done && <p className="notice">Done. Reload the page to see the new entries and payments.</p>}
        </div>
      )}
    </details>
  );
}
