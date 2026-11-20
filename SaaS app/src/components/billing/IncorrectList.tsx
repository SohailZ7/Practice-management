"use client";

import { useRouter } from "next/navigation";
import { useState } from "react";
import { resolveIncorrect, deleteEncounter } from "@/app/billing/actions";

type Row = { id: string; patient: string; date: string; client: string; chargeCode: string; note: string; action: string; deleted: boolean; complete: boolean };

export function IncorrectList({ rows }: { rows: Row[] }) {
  const router = useRouter();
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(false);
  const run = async (fn: () => Promise<{ error?: string }>) => {
    setBusy(true); setError("");
    try { const r = await fn(); if (r.error) setError(r.error); else router.refresh(); } catch { setError("That did not work. Try again."); } finally { setBusy(false); }
  };
  const open = rows.filter((r) => !r.complete);
  return (
    <>
      <h2>Incorrect Billing <span className="count-chip">{open.length}</span></h2>
      <p className="muted small">Encounters flagged as billed wrongly. Do the action, then mark complete. Nothing is erased.</p>
      {error && <p role="alert" className="error small">{error}</p>}
      <div className="table-wrap">
        <table>
          <thead><tr><th>Patient</th><th>Encounter date</th><th>Client</th><th>Charge code</th><th>Action needed</th><th>Note</th><th aria-label="Actions" /></tr></thead>
          <tbody>
            {rows.length === 0 && <tr><td colSpan={7} className="muted">Nothing here. Use Incorrect on an encounter in Billing to add one.</td></tr>}
            {rows.map((r) => (
              <tr key={r.id} style={r.complete ? { opacity: 0.55 } : undefined}>
                <td>{r.patient}</td><td>{r.date}</td><td>{r.client}</td><td>{r.chargeCode}</td>
                <td>{r.complete ? "Complete" : r.action}</td><td>{r.note}</td>
                <td>
                  {!r.complete && !r.deleted && <button type="button" className="secondary sm" disabled={busy} onClick={() => void run(() => deleteEncounter(r.id))}>Delete here</button>}{" "}
                  {!r.complete && <button type="button" className="sm" disabled={busy} onClick={() => void run(() => resolveIncorrect(r.id))}>Mark complete</button>}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </>
  );
}
