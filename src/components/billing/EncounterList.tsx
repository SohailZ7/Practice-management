"use client";

import Link from "next/link";
import { useState } from "react";
import { listEncounters } from "@/app/billing/actions";
import type { EncounterFilters, EncounterRow } from "@/lib/billing/types";
import { RowActions } from "./RowActions";

type Opt = { id: string; name: string };

export function EncounterList({
  initialRows,
  initialFilters,
  programs,
  people,
  isAdmin,
  canEdit,
}: {
  initialRows: EncounterRow[];
  initialFilters: EncounterFilters;
  programs: Opt[];
  people: Opt[];
  isAdmin: boolean;
  canEdit: boolean;
}) {
  const [f, setF] = useState(initialFilters);
  const [rows, setRows] = useState(initialRows);
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(false);

  async function run(next = f) {
    setBusy(true);
    setError("");
    try {
      setRows(await listEncounters(next));
    } catch (e) {
      setError(e instanceof Error ? e.message : "Could not load encounters");
    } finally {
      setBusy(false);
    }
  }
  const set = <K extends keyof EncounterFilters>(k: K, v: EncounterFilters[K]) => setF((s) => ({ ...s, [k]: v }));

  return (
    <div>
      <form
        className="card row"
        onSubmit={(e) => {
          e.preventDefault();
          run();
        }}
      >
        <input className="grow" placeholder="Patient name or MRN" value={f.q} onChange={(e) => set("q", e.target.value)} aria-label="Patient name or MRN" />
        <label className="check">
          From <input type="date" value={f.from} onChange={(e) => set("from", e.target.value)} />
        </label>
        <label className="check">
          To <input type="date" value={f.to} onChange={(e) => set("to", e.target.value)} />
        </label>
        <select value={f.programId} onChange={(e) => set("programId", e.target.value)} aria-label="Program">
          <option value="">All programs</option>
          {programs.map((p) => (
            <option key={p.id} value={p.id}>
              {p.name}
            </option>
          ))}
        </select>
        <select value={f.status} onChange={(e) => set("status", e.target.value as EncounterFilters["status"])} aria-label="GetIX status">
          <option value="all">Any GetIX status</option>
          <option value="pending">Not yet in GetIX</option>
          <option value="entered">Entered into GetIX</option>
        </select>
        <select value={f.mrn} onChange={(e) => set("mrn", e.target.value as EncounterFilters["mrn"])} aria-label="MRN">
          <option value="any">Any MRN</option>
          <option value="missing">MRN missing</option>
        </select>
        {isAdmin && (
          <>
            <select value={f.by} onChange={(e) => set("by", e.target.value)} aria-label="Entered by">
              <option value="">Entered by anyone</option>
              {people.map((p) => (
                <option key={p.id} value={p.id}>
                  {p.name}
                </option>
              ))}
            </select>
            <select value={f.show} onChange={(e) => set("show", e.target.value as EncounterFilters["show"])} aria-label="Show">
              <option value="active">Active encounters</option>
              <option value="deleted">Deleted encounters</option>
            </select>
          </>
        )}
        <button type="submit" disabled={busy}>
          {busy ? "Searching…" : "Search"}
        </button>
        {canEdit && (
          <Link className="btn secondary" href="/billing/new">
            + New encounter
          </Link>
        )}
      </form>

      {error && <div className="error">{error}</div>}

      <div className="table-wrap">
        <table>
          <thead>
            <tr>
              <th>Date</th>
              <th>Patient</th>
              <th>MRN</th>
              <th>Program</th>
              <th>ICD-10</th>
              <th>Charge / note</th>
              <th>Entered by</th>
              <th>GetIX</th>
              <th></th>
            </tr>
          </thead>
          <tbody>
            {rows.length === 0 && (
              <tr>
                <td colSpan={9} className="muted">
                  No encounters match.
                </td>
              </tr>
            )}
            {rows.map((r) => (
              <tr key={r.id} style={r.deleted ? { opacity: 0.6 } : undefined}>
                <td>{r.date}</td>
                <td>
                  <Link href={`/billing/patients/${r.patientId}`}>{r.patientName}</Link>
                </td>
                <td>{r.mrn ?? <span className="pill warn">No MRN yet</span>}</td>
                <td>{r.program}</td>
                <td>
                  <strong>{r.icd10Codes[0]}</strong>
                  {r.icd10Codes.length > 1 && <span className="muted"> {r.icd10Codes.slice(1).join(", ")}</span>}
                </td>
                <td>
                  {r.chargeCode && <strong>{r.chargeCode} </strong>}
                  <span className="muted">{r.note}</span>
                </td>
                <td>{r.enteredBy}</td>
                <td>
                  {r.deleted ? (
                    <span className="pill bad">Deleted</span>
                  ) : r.getixEntered ? (
                    <span className="pill ok" title="Locked">🔒 In GetIX {r.getixEnteredAt}</span>
                  ) : (
                    <span className="pill warn">Waiting</span>
                  )}
                </td>
                <td>
                  <RowActions
                    id={r.id}
                    getixEntered={r.getixEntered}
                    deleted={r.deleted}
                    canChange={r.canChange}
                    isAdmin={isAdmin}
                    onDone={() => run()}
                    onError={setError}
                  />
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      <p className="muted small">Showing up to 300 encounters. {rows.length} shown.</p>
    </div>
  );
}
