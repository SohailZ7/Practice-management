"use client";

import { useRouter } from "next/navigation";
import { useState } from "react";
import { RowActions } from "./RowActions";

type Row = {
  id: string;
  date: string;
  program: string;
  icd10Codes: string[];
  chargeCode: string;
  note: string;
  enteredBy: string;
  getixEntered: boolean;
  getixEnteredAt: string | null;
  deleted: boolean;
  canChange: boolean;
};

export function PatientEncounters({ rows, isAdmin }: { rows: Row[]; isAdmin: boolean }) {
  const router = useRouter();
  const [error, setError] = useState("");
  return (
    <>
      {error && <div className="error">{error}</div>}
      <div className="table-wrap">
        <table>
          <thead>
            <tr>
              <th>Date</th>
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
                <td colSpan={7} className="muted">
                  No encounters yet.
                </td>
              </tr>
            )}
            {rows.map((r) => (
              <tr key={r.id} style={r.deleted ? { opacity: 0.6 } : undefined}>
                <td>{r.date}</td>
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
                    <span className="pill ok">🔒 In GetIX {r.getixEnteredAt}</span>
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
                    onDone={() => router.refresh()}
                    onError={setError}
                  />
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </>
  );
}
