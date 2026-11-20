"use client";

import Link from "next/link";
import { useState } from "react";
import { listEncounters } from "@/app/billing/actions";
import type { EncounterFilters, EncounterRow } from "@/lib/billing/types";
import { Phi } from "@/components/Phi";
import { initialsFor } from "@/lib/prefs";
import { RowActions } from "./RowActions";
import { EncounterReview } from "./EncounterReview";

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
  const [review, setReview] = useState<string | null>(null);
  const [stage, setStage] = useState<"all" | "needs" | "waiting" | "entered">("all");

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
  const live = rows.filter((r) => !r.deleted);
  const stages = [
    { key: "all" as const, label: "All shown", n: rows.length, note: "Every encounter in this search", dot: "plum" },
    { key: "needs" as const, label: "Needs details", n: live.filter((r) => !r.getixEntered && !r.mrn).length, note: "No MRN yet", dot: "amber" },
    { key: "waiting" as const, label: "Waiting for GetIX", n: live.filter((r) => !r.getixEntered).length, note: "Ready for manual entry", dot: "plum" },
    { key: "entered" as const, label: "Entered in GetIX", n: live.filter((r) => r.getixEntered).length, note: "Locked, entered by hand", dot: "green" },
  ];
  const shown = rows.filter((r) =>
    stage === "all" ? true : r.deleted ? false : stage === "needs" ? !r.getixEntered && !r.mrn : stage === "waiting" ? !r.getixEntered : r.getixEntered,
  );
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
      </form>

      {error && <div className="error">{error}</div>}

      <section className="stage-row" aria-label="Encounter stages">
        {stages.map((c) => (
          <button key={c.key} type="button" className={stage === c.key ? "stage-card on" : "stage-card"} aria-pressed={stage === c.key} onClick={() => setStage(c.key)}>
            <span className="stage-top"><span>{c.label}</span><span className={`stage-dot ${c.dot}`} aria-hidden="true" /></span>
            <span className="stage-n">{c.n}</span>
            <span className="stage-note">{c.note}</span>
          </button>
        ))}
      </section>

      <div className="table-wrap enc-table">
        <table>
          <thead>
            <tr>
              <th>Patient</th>
              <th>Date</th>
              <th>Program</th>
              <th>Charge code</th>
              <th>ICD-10</th>
              <th>Entered by</th>
              <th>Stage</th>
              <th></th>
            </tr>
          </thead>
          <tbody>
            {shown.length === 0 && (
              <tr>
                <td colSpan={8} className="muted">
                  No encounters match.
                </td>
              </tr>
            )}
            {shown.map((r) => (
              <tr key={r.id} style={r.deleted ? { opacity: 0.6 } : undefined}>
                <td>
                  <span className="pat-cell">
                    <span className="avatar sm" aria-hidden="true">{initialsFor(r.patientName)}</span>
                    <span>
                      <Link href={`/billing/patients/${r.patientId}`}><strong><Phi name={r.patientName} /></strong></Link>
                      <span className="sub">{r.mrn ?? "No MRN yet"}</span>
                    </span>
                  </span>
                </td>
                <td className="num">{r.date}</td>
                <td>
                  {r.program}
                  {r.note && <span className="sub">{r.note}</span>}
                </td>
                <td>{r.chargeCode ? <strong>{r.chargeCode}</strong> : <span className="amber-text">Needs details</span>}</td>
                <td>
                  <strong>{r.icd10Codes[0]}</strong>
                  {r.icd10Codes.length > 1 && <span className="muted"> {r.icd10Codes.slice(1).join(", ")}</span>}
                </td>
                <td>{r.enteredBy}</td>
                <td>
                  {r.deleted ? (
                    <span className="pill bad">Deleted</span>
                  ) : r.getixEntered ? (
                    <span className="pill ok" title="Locked">In GetIX {r.getixEnteredAt}</span>
                  ) : r.stage === "verified" ? (
                    <span className="pill ok">{r.chargeCode.toUpperCase() === "NB DC" ? "Verified (NB DC, not GetIX)" : "Verified"}</span>
                  ) : r.stage === "submitted" ? (
                    <span className="pill">Submitted</span>
                  ) : r.mrn ? (
                    <span className="pill">Draft</span>
                  ) : (
                    <span className="pill warn">Needs details</span>
                  )}
                </td>
                <td>
                  <button type="button" className="secondary sm" onClick={() => setReview(r.id)} style={{ marginRight: ".35rem" }}>Review</button>
                  <RowActions
                    id={r.id}
                    getixEntered={r.getixEntered}
                    stage={r.stage}
                    incorrect={r.incorrect}
                    isOwner={r.isOwner}
                    nbdc={r.chargeCode.toUpperCase() === "NB DC"}
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
      {review && rows.find((r) => r.id === review) && (
        <EncounterReview row={rows.find((r) => r.id === review)!} isAdmin={isAdmin} onClose={() => setReview(null)} onDone={() => run()} onError={setError} />
      )}
      <p className="small"><a href={`/billing/export?from=${encodeURIComponent(f.from)}&to=${encodeURIComponent(f.to)}`}>Download redacted charge data (no patient names)</a></p>
      <p className="muted small">Entry into GetIX stays a manual step. Showing up to 300 encounters; {shown.length} shown.</p>
    </div>
  );
}
