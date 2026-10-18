"use client";

import { useEffect, useRef, useState } from "react";
import { useRouter } from "next/navigation";
import { saveEncounter, searchPatients } from "@/app/billing/actions";
import { parseIcd10List } from "@/lib/billing/icd10";
import type { PatientHit, SaveResult } from "@/lib/billing/types";

type Opt = { id: string; name: string };

type Props = {
  programs: Opt[];
  today: string;
  /** Edit mode: the encounter being changed. The patient is shown but not editable. */
  edit?: { encounterId: string; patientLabel: string; encounterDate: string; programId: string; icd10Input: string; chargeCode: string; note: string };
  /** Start with this patient already chosen. */
  preset?: PatientHit;
};

export function EncounterForm({ programs, today, edit, preset }: Props) {
  const router = useRouter();
  const [mode, setMode] = useState<"new" | "file">(preset ? "file" : "new");
  const [picked, setPicked] = useState<PatientHit | null>(preset ?? null);
  const [mrn, setMrn] = useState("");
  const [lastName, setLastName] = useState("");
  const [firstName, setFirstName] = useState("");
  const [query, setQuery] = useState("");
  const [hits, setHits] = useState<PatientHit[]>([]);

  const [encounterDate, setDate] = useState(edit?.encounterDate ?? "");
  const [programId, setProgram] = useState(edit?.programId ?? "");
  const [icd10Input, setIcd] = useState(edit?.icd10Input ?? "");
  const [chargeCode, setCharge] = useState(edit?.chargeCode ?? "");
  const [note, setNote] = useState(edit?.note ?? "");

  const [errors, setErrors] = useState<Record<string, string>>({});
  const [confirm, setConfirm] = useState<{ patientId: string; name: string } | null>(null);
  const [saved, setSaved] = useState("");
  const [busy, setBusy] = useState(false);
  const timer = useRef<ReturnType<typeof setTimeout>>();

  const parsed = parseIcd10List(icd10Input);

  useEffect(() => {
    clearTimeout(timer.current);
    if (mode !== "file" || !query.trim()) {
      setHits([]);
      return;
    }
    timer.current = setTimeout(async () => {
      try {
        setHits(await searchPatients(query));
      } catch {
        setHits([]);
      }
    }, 250);
    return () => clearTimeout(timer.current);
  }, [query, mode]);

  async function submit(addAnother: boolean, confirmWith?: string) {
    setBusy(true);
    setErrors({});
    setSaved("");
    let result: SaveResult;
    try {
      result = await saveEncounter({
        encounterId: edit?.encounterId,
        patientId: mode === "file" ? picked?.id : undefined,
        mrn,
        lastName,
        firstName,
        confirm: confirmWith,
        encounterDate,
        programId,
        icd10Input,
        chargeCode,
        note,
      });
    } catch (e) {
      setErrors({ form: e instanceof Error ? e.message : "Could not save" });
      setBusy(false);
      return;
    }
    setBusy(false);
    if (!result.ok) {
      if (result.confirm) setConfirm(result.confirm);
      else setErrors(result.errors);
      return;
    }
    setConfirm(null);
    if (edit || !addAnother) {
      router.push(`/billing/patients/${result.patientId}`);
      router.refresh();
      return;
    }
    // Save and add another: keep the patient, clear the encounter.
    const label = picked?.name ?? `${lastName}, ${firstName}`;
    setPicked({ id: result.patientId, mrn: picked?.mrn ?? (mrn || null), name: label });
    setMode("file");
    setDate("");
    setIcd("");
    setCharge("");
    setNote("");
    setSaved("Saved. Add the next encounter for this patient, or choose another patient.");
  }

  const err = (k: string) => (errors[k] ? <div className="field-error">{errors[k]}</div> : null);

  return (
    <form
      className="card enc-form"
      onSubmit={(e) => {
        e.preventDefault();
        submit(false);
      }}
    >
      {errors.form && <div className="error">{errors.form}</div>}
      {saved && <div className="notice">{saved}</div>}

      <fieldset>
        <legend>Patient</legend>
        {edit ? (
          <div>{edit.patientLabel}</div>
        ) : (
          <>
            <div className="seg" role="tablist" aria-label="Patient source" style={{ marginBottom: ".6rem" }}>
              <a role="tab" aria-selected={mode === "new"} className={mode === "new" ? "on" : ""} onClick={() => setMode("new")}>
                New patient
              </a>
              <a role="tab" aria-selected={mode === "file"} className={mode === "file" ? "on" : ""} onClick={() => setMode("file")}>
                Patient on file
              </a>
            </div>
            {mode === "new" ? (
              <div className="row">
                <label className="grow">
                  Last name
                  <input value={lastName} onChange={(e) => setLastName(e.target.value)} autoComplete="off" />
                  {err("lastName")}
                </label>
                <label className="grow">
                  First name
                  <input value={firstName} onChange={(e) => setFirstName(e.target.value)} autoComplete="off" />
                  {err("firstName")}
                </label>
                <label className="grow">
                  MRN <span className="muted small">(leave blank if you don't have it)</span>
                  <input value={mrn} onChange={(e) => setMrn(e.target.value)} autoComplete="off" />
                  {err("mrn")}
                </label>
              </div>
            ) : picked ? (
              <div className="row">
                <strong>{picked.name}</strong>
                <span className="muted">{picked.mrn ? `MRN ${picked.mrn}` : "No MRN yet"}</span>
                <button type="button" className="secondary" onClick={() => setPicked(null)}>
                  Change
                </button>
              </div>
            ) : (
              <div>
                <input
                  placeholder="Search by name or MRN (e.g. Smith, Jo)"
                  value={query}
                  onChange={(e) => setQuery(e.target.value)}
                  autoComplete="off"
                  style={{ width: "100%" }}
                  aria-label="Search patients"
                />
                <ul className="pick-list">
                  {hits.map((h) => (
                    <li key={h.id}>
                      <button
                        type="button"
                        className="secondary"
                        onClick={() => {
                          setPicked(h);
                          setQuery("");
                          setHits([]);
                        }}
                      >
                        {h.name} <span className="muted">{h.mrn ? `MRN ${h.mrn}` : "No MRN yet"}</span>
                      </button>
                    </li>
                  ))}
                  {query.trim() && hits.length === 0 && <li className="muted small">No match among your patients.</li>}
                </ul>
              </div>
            )}
            {err("patient")}
          </>
        )}
      </fieldset>

      {confirm && (
        <div className="notice" role="alert">
          You already have a patient with this name: <strong>{confirm.name}</strong>. Is this the same person?
          <div className="row" style={{ marginTop: ".5rem" }}>
            <button type="button" disabled={busy} onClick={() => submit(false, confirm.patientId)}>
              Yes, same person
            </button>
            <button type="button" className="secondary" disabled={busy} onClick={() => submit(false, "new")}>
              No, a different person
            </button>
          </div>
        </div>
      )}

      <fieldset>
        <legend>Encounter</legend>
        <div className="row">
          <label>
            Encounter date
            <input type="date" max={today} value={encounterDate} onChange={(e) => setDate(e.target.value)} />
            {err("encounterDate")}
          </label>
          <label className="grow">
            Program
            <select value={programId} onChange={(e) => setProgram(e.target.value)}>
              <option value="">Choose a program…</option>
              {programs.map((p) => (
                <option key={p.id} value={p.id}>
                  {p.name}
                </option>
              ))}
            </select>
            {err("programId")}
          </label>
        </div>
        <label style={{ display: "block", marginTop: ".6rem" }}>
          ICD-10 codes <span className="muted small">(the first is the primary code; separate with commas or spaces)</span>
          <input value={icd10Input} onChange={(e) => setIcd(e.target.value)} placeholder="F32.A, E11.9" autoComplete="off" style={{ width: "100%" }} />
        </label>
        <div className="chips" aria-live="polite">
          {parsed.codes.map((c, i) => (
            <span key={c} className={`pill ${i === 0 ? "ok" : ""}`}>
              {c}
              {i === 0 ? " · primary" : ""}
            </span>
          ))}
          {parsed.invalid.map((c) => (
            <span key={c} className="pill bad">
              {c}?
            </span>
          ))}
        </div>
        {err("icd10Codes")}
        <div className="row" style={{ marginTop: ".6rem" }}>
          <label>
            Charge code
            <input value={chargeCode} onChange={(e) => setCharge(e.target.value)} autoComplete="off" />
            {err("chargeCode")}
          </label>
          <label className="grow">
            Note <span className="muted small">(charge code, note, or both)</span>
            <input value={note} onChange={(e) => setNote(e.target.value)} autoComplete="off" style={{ width: "100%" }} />
            {err("note")}
          </label>
        </div>
      </fieldset>

      <div className="row" style={{ marginTop: "1rem" }}>
        <button type="submit" disabled={busy}>
          {edit ? "Save changes" : "Save encounter"}
        </button>
        {!edit && (
          <button type="button" className="secondary" disabled={busy} onClick={() => submit(true)}>
            Save and add another
          </button>
        )}
      </div>
    </form>
  );
}
