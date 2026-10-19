"use client";

import { useState } from "react";
import type { EntryDTO } from "@/lib/scheduleTypes";
import {
  createPatient,
  linkPatient,
  searchPatients,
  setConsent,
  withdrawConsent,
  type PatientOption,
} from "@/app/schedule/patient-actions";

type Props = {
  row: EntryDTO;
  today: string;
  showMrn: boolean;
  onChange: (patch: Partial<EntryDTO>) => void;
  onError: (message: string) => void;
};

/** Patient link and consent badge shown under the Client cell of a saved schedule row (requirements v19, PAT-2, CON-2). */
export function PatientLink({ row, today, showMrn, onChange, onError }: Props) {
  const [open, setOpen] = useState(false);
  const [q, setQ] = useState("");
  const [hits, setHits] = useState<PatientOption[]>([]);
  const [creating, setCreating] = useState(false);
  const [last, setLast] = useState("");
  const [first, setFirst] = useState("");
  const [mrn, setMrn] = useState("");
  const [busy, setBusy] = useState(false);

  const guard = async (fn: () => Promise<void>) => {
    setBusy(true);
    try {
      await fn();
    } catch (e) {
      onError(e instanceof Error ? e.message : "Could not save");
    } finally {
      setBusy(false);
    }
  };

  const apply = async (patientId: string | null) =>
    guard(async () => {
      const dto = await linkPatient(row.id, patientId);
      onChange({ patientId: dto.patientId, consent: dto.consent, clientInfo: dto.clientInfo });
      setOpen(false);
      setCreating(false);
      setQ("");
      setHits([]);
    });

  const toggleConsent = () =>
    guard(async () => {
      if (!row.patientId) return;
      if (row.consent === "on_file") {
        if (!window.confirm("Withdraw this patient's AI documentation consent? Recording will be turned off for them.")) return;
        const r = await withdrawConsent(row.patientId);
        if (!r.ok) throw new Error(Object.values(r.errors)[0]);
        onChange({ consent: "none" });
        return;
      }
      const date = window.prompt("Patient signed AI documentation consent on (YYYY-MM-DD):", today);
      if (date === null) return;
      const note = window.prompt("Optional note (for example, signed intake form):", "") ?? "";
      const r = await setConsent(row.patientId, { consentDate: date, note });
      if (!r.ok) throw new Error(Object.values(r.errors)[0]);
      onChange({ consent: "on_file" });
    });

  const search = async (text: string) => {
    setQ(text);
    if (text.trim().length < 2) return setHits([]);
    try {
      setHits(await searchPatients(text));
    } catch (e) {
      onError(e instanceof Error ? e.message : "Search failed");
    }
  };

  const create = () =>
    guard(async () => {
      const r = await createPatient({ lastName: last, firstName: first, mrn });
      if (!r.ok) throw new Error(Object.values(r.errors)[0]);
      await apply(r.patient.id);
    });

  return (
    <div className="small" style={{ marginTop: 2 }}>
      {row.patientId ? (
        <span className="row" style={{ gap: ".4rem" }}>
          <button type="button" className="secondary" disabled={busy} onClick={toggleConsent} title="Click to change consent">
            {row.consent === "on_file" ? "Consent on file" : "No consent"}
          </button>
          <button type="button" className="secondary" disabled={busy} onClick={() => apply(null)} title="Unlink patient">
            Unlink
          </button>
        </span>
      ) : open ? (
        <div>
          {!creating ? (
            <>
              <input value={q} onChange={(e) => search(e.target.value)} placeholder="Search: Last, First or MRN" aria-label="Search patients" autoFocus />
              {hits.map((h) => (
                <div key={h.id}>
                  <button type="button" className="secondary" disabled={busy} onClick={() => apply(h.id)}>
                    {h.name}
                    {showMrn && h.mrn ? ` · ${h.mrn}` : ""}
                  </button>
                </div>
              ))}
              <button type="button" className="secondary" onClick={() => setCreating(true)}>
                New patient
              </button>
            </>
          ) : (
            <>
              <input value={last} onChange={(e) => setLast(e.target.value)} placeholder="Last name" aria-label="Last name" />
              <input value={first} onChange={(e) => setFirst(e.target.value)} placeholder="First name" aria-label="First name" />
              {showMrn && <input value={mrn} onChange={(e) => setMrn(e.target.value)} placeholder="MRN (optional)" aria-label="MRN" />}
              <button type="button" disabled={busy} onClick={create}>
                Add and link
              </button>
            </>
          )}
          <button type="button" className="secondary" onClick={() => { setOpen(false); setCreating(false); }}>
            Cancel
          </button>
        </div>
      ) : (
        <button type="button" className="secondary" onClick={() => setOpen(true)}>
          Link patient
        </button>
      )}
    </div>
  );
}
