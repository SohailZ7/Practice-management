"use client";

import Link from "next/link";
import { useState } from "react";
import { listPatients } from "@/app/billing/actions";
import type { PatientFilters, PatientRow } from "@/lib/billing/types";

type Opt = { id: string; name: string };

export function PatientList({
  initialRows,
  initialFilters,
  programs,
  people,
  isAdmin,
}: {
  initialRows: PatientRow[];
  initialFilters: PatientFilters;
  programs: Opt[];
  people: Opt[];
  isAdmin: boolean;
}) {
  const [f, setF] = useState(initialFilters);
  const [rows, setRows] = useState(initialRows);
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(false);
  const set = <K extends keyof PatientFilters>(k: K, v: PatientFilters[K]) => setF((s) => ({ ...s, [k]: v }));

  async function run() {
    setBusy(true);
    setError("");
    try {
      setRows(await listPatients(f));
    } catch (e) {
      setError(e instanceof Error ? e.message : "Could not load patients");
    } finally {
      setBusy(false);
    }
  }

  return (
    <div>
      <form
        className="card row"
        onSubmit={(e) => {
          e.preventDefault();
          run();
        }}
      >
        <input className="grow" placeholder="Name or MRN (e.g. Smith, Jo)" value={f.q} onChange={(e) => set("q", e.target.value)} aria-label="Name or MRN" />
        <label className="check">
          Seen from <input type="date" value={f.from} onChange={(e) => set("from", e.target.value)} />
        </label>
        <label className="check">
          to <input type="date" value={f.to} onChange={(e) => set("to", e.target.value)} />
        </label>
        <select value={f.programId} onChange={(e) => set("programId", e.target.value)} aria-label="Program">
          <option value="">All programs</option>
          {programs.map((p) => (
            <option key={p.id} value={p.id}>
              {p.name}
            </option>
          ))}
        </select>
        <label className="check">
          <input type="checkbox" checked={f.waiting} onChange={(e) => set("waiting", e.target.checked)} /> Waiting for GetIX
        </label>
        <select value={f.mrn} onChange={(e) => set("mrn", e.target.value as PatientFilters["mrn"])} aria-label="MRN">
          <option value="any">Any MRN</option>
          <option value="missing">MRN missing</option>
        </select>
        {isAdmin && (
          <select value={f.by} onChange={(e) => set("by", e.target.value)} aria-label="Entered by">
            <option value="">Entered by anyone</option>
            {people.map((p) => (
              <option key={p.id} value={p.id}>
                {p.name}
              </option>
            ))}
          </select>
        )}
        <button type="submit" disabled={busy}>
          {busy ? "Searching…" : "Search"}
        </button>
      </form>
      {error && <div className="error">{error}</div>}
      <div className="table-wrap">
        <table>
          <thead>
            <tr>
              <th>Patient</th>
              <th>MRN</th>
              <th>Last seen</th>
              <th>Encounters</th>
              <th>Waiting for GetIX</th>
            </tr>
          </thead>
          <tbody>
            {rows.length === 0 && (
              <tr>
                <td colSpan={5} className="muted">
                  No patients match.
                </td>
              </tr>
            )}
            {rows.map((p) => (
              <tr key={p.id}>
                <td>
                  <Link href={`/billing/patients/${p.id}`}>{p.name}</Link>
                </td>
                <td>{p.mrn ?? <span className="pill warn">No MRN yet</span>}</td>
                <td>{p.lastSeen}</td>
                <td>{p.encounters}</td>
                <td>{p.waiting > 0 ? <span className="pill warn">{p.waiting}</span> : <span className="muted">0</span>}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  );
}
