"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { documentsFor } from "@/lib/notes/documents";
import type { VisitRow } from "@/lib/notes/queries";
import { useEffect } from "react";
import type { VisitOptions } from "@/lib/notes/options";
import { getVisitTranscript, visitOptions, addVisitAction, deleteVisitAction, deleteVisitsAction, generateForVisit, loadPastedSchedule, saveTranscript, updateVisitAction, warmUp } from "@/app/notes/actions";
import { DocumentEditor } from "./DocumentEditor";

const shift = (iso: string, days: number) => {
  const d = new Date(`${iso}T00:00:00Z`);
  d.setUTCDate(d.getUTCDate() + days);
  return d.toISOString().slice(0, 10);
};
const longDate = (iso: string) =>
  new Date(`${iso}T00:00:00Z`).toLocaleDateString("en-US", { weekday: "long", month: "long", day: "numeric", year: "numeric", timeZone: "UTC" });

export function NotesBoard({ date, visits, canEdit, defaultProvider }: {
  date: string; visits: VisitRow[]; canEdit: boolean; defaultProvider: string;
}) {
  const router = useRouter();
  const [pending, start] = useTransition();
  const [pasting, setPasting] = useState(false);
  const [adding, setAdding] = useState(false);
  const [picked, setPicked] = useState<string[]>([]);
  const selected = picked.filter((id) => visits.some((v) => v.id === id));
  const [note, setNote] = useState("");
  const [openDoc, setOpenDoc] = useState<{ id: string; label: string } | null>(null);
  const [busyVisit, setBusyVisit] = useState("");
  const [reading, setReading] = useState<string | null>(null);

  const go = (d: string) => router.push(`/notes?date=${d}`);

  return (
    <>
      <div className="row" style={{ marginBottom: ".75rem" }}>
        <h1 style={{ margin: 0 }}>Notes</h1>
        <span className="grow" />
        {canEdit && <button className="secondary" onClick={() => setAdding((v) => !v)}>{adding ? "Cancel" : "Add a visit"}</button>}
        {canEdit && <button className="secondary" onClick={() => setPasting((v) => !v)}>{pasting ? "Cancel" : "Paste a schedule"}</button>}
      </div>

      <div className="row" style={{ marginBottom: "1rem" }}>
        <button className="secondary" aria-label="Previous day" onClick={() => go(shift(date, -1))}>←</button>
        <button className="secondary" onClick={() => go(new Date().toISOString().slice(0, 10))}>Today</button>
        <button className="secondary" aria-label="Next day" onClick={() => go(shift(date, 1))}>→</button>
        <strong style={{ margin: "0 .5rem" }}>{longDate(date)}</strong>
        <input type="date" value={date} aria-label="Pick a date" onChange={(e) => e.target.value && go(e.target.value)} />
      </div>

      {note && <div className="card" role="status">{note} <button className="link" onClick={() => setNote("")}>Dismiss</button></div>}

      {adding && <AddVisit date={date} defaultProvider={defaultProvider} onDone={(m) => { setAdding(false); setNote(m); router.refresh(); }} />}

      {pasting && <PasteSchedule date={date} defaultProvider={defaultProvider} onDone={(m) => { setPasting(false); setNote(m); router.refresh(); }} />}

      {canEdit && selected.length > 0 && (
        <div className="row" style={{ marginBottom: ".5rem" }}>
          <button
            className="secondary"
            disabled={pending}
            onClick={() => {
              const withData = visits.filter((v) => selected.includes(v.id) && (v.hasTranscript || v.documents.length > 0)).length;
              const extra = withData ? ` The transcripts and generated documents of those visits are deleted too (${withData} have some).` : "";
              if (!window.confirm(`Delete ${selected.length} visit${selected.length === 1 ? "" : "s"}?${extra} This cannot be undone.`)) return;
              start(async () => {
                const r = await deleteVisitsAction(selected);
                setNote(r.ok ? `Deleted ${r.deleted} visit${r.deleted === 1 ? "" : "s"}.` : r.error);
                setPicked([]);
                router.refresh();
              });
            }}
          >
            Delete selected ({selected.length})
          </button>
          <button className="link" onClick={() => setPicked([])}>Clear</button>
        </div>
      )}

      {visits.length === 0 ? (
        <p className="muted">No visits loaded for this day. {canEdit && "Use “Paste a schedule” to load one."}</p>
      ) : (
        <table className="xl">
          <thead>
            <tr>{canEdit && <th><input type="checkbox" aria-label="Select all visits" checked={selected.length === visits.length} onChange={(e) => setPicked(e.target.checked ? visits.map((v) => v.id) : [])} /></th>}<th>Patient</th><th>Time</th><th>Program</th><th>Type</th><th>Documents</th><th /></tr>
          </thead>
          <tbody>
            {visits.map((v) => (
              <tr key={v.id}>
                {canEdit && (
                  <td>
                    <input type="checkbox" aria-label="Select visit" checked={selected.includes(v.id)} onChange={(e) => setPicked(e.target.checked ? [...selected, v.id] : selected.filter((i) => i !== v.id))} />
                  </td>
                )}
                <td title="Shown as initials">
                  {v.initials}{" "}
                  <button
                    className="link"
                    title={v.hasTranscript ? "View the transcript (read-only)" : "No transcript yet"}
                    aria-label={`View transcript for ${v.initials}`}
                    disabled={!v.hasTranscript}
                    onClick={() => setReading(v.id)}
                  >
                    📄
                  </button>
                </td>
                <td>
                  {canEdit ? (
                    <EditableTime visitId={v.id} value={v.apptTime} onError={setNote} onSaved={() => router.refresh()} />
                  ) : (
                    v.apptTime
                  )}
                </td>
                <td>{v.program}</td>
                <td>{v.appointmentType}</td>
                <td>
                  {v.documents.length === 0 ? (
                    <span className="muted small">{documentsFor(v.appointmentType).map((d) => d.label).join(", ") || "none"}</span>
                  ) : (
                    <span className="row" style={{ flexWrap: "wrap", gap: ".3rem" }}>
                      {v.documents.map((d) => (
                        <button key={d.id} className="secondary small" onClick={() => setOpenDoc({ id: d.id, label: d.label })}>
                          {d.label}{d.draft ? " · draft" : ""}
                        </button>
                      ))}
                    </span>
                  )}
                </td>
                <td style={{ textAlign: "right", whiteSpace: "nowrap" }}>
                  {canEdit && (
                    <>
                      <button
                        className="secondary"
                        disabled={pending}
                        onClick={() => {
                          const extra = v.documents.length || v.hasTranscript ? " Its transcript and documents are deleted too." : "";
                          if (!window.confirm(`Delete the visit for ${v.initials}?${extra} This cannot be undone.`)) return;
                          start(async () => {
                            const r = await deleteVisitAction(v.id);
                            setNote(r.ok ? "Visit deleted." : r.error);
                            router.refresh();
                          });
                        }}
                      >
                        Delete
                      </button>{" "}
                      <TranscriptButton visitId={v.id} hasTranscript={v.hasTranscript} onSaved={() => router.refresh()} />
                      <button
                        disabled={!v.hasTranscript || pending || busyVisit === v.id}
                        onClick={() => {
                          setBusyVisit(v.id);
                          void warmUp();
                          start(async () => {
                            try {
                              const r = await generateForVisit(v.id);
                              setNote(r.error ?? `Wrote ${r.created} document${r.created === 1 ? "" : "s"}.`);
                              router.refresh();
                            } catch (e) {
                              setNote(e instanceof Error ? e.message : String(e));
                            } finally {
                              setBusyVisit("");
                            }
                          });
                        }}
                      >
                        {busyVisit === v.id ? "Writing…" : "Generate"}
                      </button>
                    </>
                  )}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      )}

      {reading && <TranscriptView visitId={reading} onClose={() => setReading(null)} />}

      {openDoc && <DocumentEditor documentId={openDoc.id} label={openDoc.label} canEdit={canEdit} onClose={() => { setOpenDoc(null); router.refresh(); }} />}
    </>
  );
}

function TranscriptButton({ visitId, hasTranscript, onSaved }: { visitId: string; hasTranscript: boolean; onSaved: () => void }) {
  const [open, setOpen] = useState(false);
  const [text, setText] = useState("");
  const [saving, setSaving] = useState(false);
  if (!open) {
    return (
      <button className="secondary" onClick={() => setOpen(true)} style={{ marginRight: ".4rem" }}>
        {hasTranscript ? "Transcript ✓" : "Add transcript"}
      </button>
    );
  }
  return (
    <div className="card" style={{ textAlign: "left", marginTop: ".4rem" }}>
      <p className="small muted">Paste the transcript. The recorder normally sends this; this box is for testing and for a visit typed up by hand.</p>
      <textarea rows={6} value={text} onChange={(e) => setText(e.target.value)} aria-label="Transcript" style={{ width: "100%" }} />
      <div className="row">
        <button disabled={!text.trim() || saving} onClick={async () => {
          setSaving(true);
          try { await saveTranscript(visitId, text); setOpen(false); onSaved(); } finally { setSaving(false); }
        }}>Save transcript</button>
        <button className="secondary" onClick={() => setOpen(false)}>Cancel</button>
      </div>
    </div>
  );
}

function PasteSchedule({ date, defaultProvider, onDone }: { date: string; defaultProvider: string; onDone: (m: string) => void }) {
  const [text, setText] = useState("");
  const [provider, setProvider] = useState(defaultProvider);
  const [busy, setBusy] = useState(false);
  return (
    <div className="card">
      <h2 style={{ marginTop: 0 }}>Paste the board for {longDate(date)}</h2>
      <p className="small muted">Copy the day's rows from the Outpatient Board, including the header row. Only rows for the provider below are kept; leave it empty to keep every row.</p>
      <label className="row">Provider <input value={provider} onChange={(e) => setProvider(e.target.value)} placeholder="Dr. Khalid Ahmed" /></label>
      <textarea rows={8} value={text} onChange={(e) => setText(e.target.value)} aria-label="Pasted schedule" style={{ width: "100%", fontFamily: "ui-monospace, Menlo, monospace", fontSize: 12 }} />
      <button disabled={!text.trim() || busy} onClick={async () => {
        setBusy(true);
        try {
          const r = await loadPastedSchedule(date, text, provider);
          onDone(`Loaded ${r.created} visit${r.created === 1 ? "" : "s"} from ${r.summary.kept} row${r.summary.kept === 1 ? "" : "s"}.` +
            (r.otherProviders.length ? ` Skipped ${r.summary.skippedOtherProvider} for ${r.otherProviders.join(", ")}.` : ""));
        } catch (e) {
          onDone(e instanceof Error ? e.message : String(e));
        } finally {
          setBusy(false);
        }
      }}>{busy ? "Loading…" : "Load schedule"}</button>
    </div>
  );
}

function EditableTime({ visitId, value, onSaved, onError }: { visitId: string; value: string; onSaved: () => void; onError: (m: string) => void }) {
  const [v, setV] = useState(value);
  return (
    <input
      value={v}
      aria-label="Appointment time"
      placeholder="2:00 PM"
      style={{ width: "8.5rem" }}
      onChange={(e) => setV(e.target.value)}
      onBlur={async () => {
        if (v.trim() === value) return;
        const r = await updateVisitAction(visitId, { apptTime: v });
        if (r.ok) onSaved();
        else {
          onError(r.error);
          setV(value);
        }
      }}
    />
  );
}

function AddVisit({ date, defaultProvider, onDone }: { date: string; defaultProvider: string; onDone: (m: string) => void }) {
  const [f, setF] = useState({ patient: "", apptTime: "", program: "", appointmentType: "", providerName: defaultProvider });
  const [opts, setOpts] = useState<VisitOptions | null>(null);
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState("");
  useEffect(() => {
    void visitOptions().then(setOpts);
  }, []);
  const set = (k: keyof typeof f) => (e: React.ChangeEvent<HTMLInputElement | HTMLSelectElement>) => setF({ ...f, [k]: e.target.value });
  const timeOk = !f.apptTime.trim() || /^\d{1,2}:\d{2}(\s*[ap]\.?m\.?)?$/i.test(f.apptTime.trim()) || /^\d{1,2}\s*[ap]\.?m\.?$/i.test(f.apptTime.trim());
  return (
    <div className="card">
      <h2 style={{ marginTop: 0 }}>Add a visit for {longDate(date)}</h2>
      <div className="row" style={{ flexWrap: "wrap" }}>
        <label>Patient <input value={f.patient} onChange={set("patient")} placeholder="First Last" required /></label>
        <label>
          Time{" "}
          <input value={f.apptTime} onChange={set("apptTime")} list="visit-times" placeholder="2:00 PM or 14:00" style={{ width: "9.5rem" }} aria-invalid={!timeOk} />
          <datalist id="visit-times">{opts?.times.map((t) => <option key={t} value={t} />)}</datalist>
        </label>
        <label>
          Program{" "}
          <input value={f.program} onChange={set("program")} list="visit-programs" placeholder="Pick or type" />
          <datalist id="visit-programs">{opts?.programs.map((t) => <option key={t} value={t} />)}</datalist>
        </label>
        <label>
          Type{" "}
          <select value={f.appointmentType} onChange={set("appointmentType")}>
            <option value="">Choose a type</option>
            {opts?.appointmentTypes.map((t) => <option key={t}>{t}</option>)}
          </select>
        </label>
        <label>
          Provider{" "}
          <select value={f.providerName} onChange={set("providerName")}>
            <option value="">Choose a provider</option>
            {opts?.providers.map((t) => <option key={t}>{t}</option>)}
          </select>
        </label>
      </div>
      {!timeOk && <p role="alert" className="small">Enter the time like 2:00 PM or 14:00.</p>}
      {err && <p role="alert" className="small">{err}</p>}
      <button disabled={!f.patient.trim() || !timeOk || busy} onClick={async () => {
        setBusy(true);
        setErr("");
        try {
          const r = await addVisitAction({ date, ...f });
          if (r.ok) onDone("Visit added.");
          else setErr(r.error);
        } finally {
          setBusy(false);
        }
      }}>{busy ? "Adding…" : "Add visit"}</button>
    </div>
  );
}

function TranscriptView({ visitId, onClose }: { visitId: string; onClose: () => void }) {
  const [state, setState] = useState<{ text: string; at: string } | { error: string } | null>(null);
  const [copied, setCopied] = useState(false);
  useEffect(() => {
    void getVisitTranscript(visitId).then((r) => setState(r.ok ? { text: r.transcript, at: r.updatedAt } : { error: r.error }));
  }, [visitId]);
  return (
    <div role="dialog" aria-label="Transcript" className="card" style={{ position: "fixed", inset: "8% 10%", overflow: "auto", zIndex: 50, background: "var(--card, Canvas)" }}>
      <div className="row">
        <h2 style={{ margin: 0 }}>Transcript</h2>
        <span className="grow" />
        <button className="secondary" disabled={!state || "error" in state} onClick={async () => {
          if (state && "text" in state) {
            try { await navigator.clipboard.writeText(state.text); setCopied(true); } catch { setCopied(false); }
          }
        }}>{copied ? "Copied" : "Copy"}</button>
        <button className="secondary" onClick={onClose}>Close</button>
      </div>
      {state && "text" in state && <p className="small muted">Uploaded to the cloud · {new Date(state.at).toLocaleString("en-US", { timeZone: "America/Los_Angeles" })}. Read-only.</p>}
      {!state && <p className="muted">Loading…</p>}
      {state && "error" in state && <p role="alert">{state.error}</p>}
      {state && "text" in state && <pre style={{ whiteSpace: "pre-wrap", userSelect: "text" }}>{state.text || "No transcript stored for this visit."}</pre>}
    </div>
  );
}
