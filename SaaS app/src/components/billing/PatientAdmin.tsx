"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { addMrn, fixPatient, mergePatients, type PatientAdminResult } from "@/app/billing/actions";

export function PatientAdmin({
  patientId,
  mrn,
  lastName,
  firstName,
}: {
  patientId: string;
  mrn: string | null;
  lastName: string;
  firstName: string;
}) {
  const router = useRouter();
  const [newMrn, setNewMrn] = useState("");
  const [fix, setFix] = useState({ mrn: mrn ?? "", lastName, firstName });
  const [error, setError] = useState("");
  const [merge, setMerge] = useState<{ keepId: string; keepName: string } | null>(null);
  const [busy, setBusy] = useState(false);

  async function run(fn: () => Promise<PatientAdminResult>) {
    setBusy(true);
    setError("");
    try {
      const r = await fn();
      if (r.ok) {
        setMerge(null);
        router.refresh();
      } else {
        setError(r.error);
        setMerge(r.merge ?? null);
      }
    } catch (e) {
      setError(e instanceof Error ? e.message : "Something went wrong");
    } finally {
      setBusy(false);
    }
  }

  return (
    <details className="card">
      <summary>Admin tools</summary>
      {error && (
        <div className="error" style={{ marginTop: ".6rem" }}>
          {error}
        </div>
      )}
      {merge && (
        <div className="notice" style={{ marginTop: ".6rem" }}>
          <strong>{merge.keepName}</strong> already has that MRN. Merge this record into it? All of this patient&apos;s
          encounters move to that record; this one is kept as merged, not erased.
          <div className="row" style={{ marginTop: ".5rem" }}>
            <button disabled={busy} onClick={() => run(() => mergePatients(merge.keepId, patientId))}>
              Merge
            </button>
            <button className="secondary" onClick={() => setMerge(null)}>
              Cancel
            </button>
          </div>
        </div>
      )}
      {!mrn && (
        <form
          className="row"
          style={{ marginTop: ".6rem" }}
          onSubmit={(e) => {
            e.preventDefault();
            run(() => addMrn(patientId, newMrn));
          }}
        >
          <input placeholder="MRN" value={newMrn} onChange={(e) => setNewMrn(e.target.value)} aria-label="MRN to add" />
          <button type="submit" disabled={busy}>
            Add MRN
          </button>
        </form>
      )}
      <form
        className="row"
        style={{ marginTop: ".6rem" }}
        onSubmit={(e) => {
          e.preventDefault();
          run(() => fixPatient(patientId, fix));
        }}
      >
        <input placeholder="Last name" value={fix.lastName} onChange={(e) => setFix({ ...fix, lastName: e.target.value })} aria-label="Last name" />
        <input placeholder="First name" value={fix.firstName} onChange={(e) => setFix({ ...fix, firstName: e.target.value })} aria-label="First name" />
        <input placeholder="MRN" value={fix.mrn} onChange={(e) => setFix({ ...fix, mrn: e.target.value })} aria-label="MRN" />
        <button type="submit" className="secondary" disabled={busy}>
          Fix name or MRN
        </button>
      </form>
    </details>
  );
}
