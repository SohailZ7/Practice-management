"use client";

import { hasSpeakers, parseTurns, speakerRole } from "@/lib/transcript/turns";
import { applyLabels, type SpeakerLabels } from "@/lib/transcript/labels";
import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import type { VisitRow } from "@/lib/notes/queries";
import { useEffect } from "react";
import { TRANSCRIPT_LOAD_ERROR, withTimeout } from "@/lib/loadGuard";
import { searchPatients, createPatient, type PatientOption } from "@/app/schedule/patient-actions";
import type { VisitOptions } from "@/lib/notes/options";
import { setClockStyle, getVisitTranscript, saveSpeakerLabels, visitOptions, addVisitAction, deleteVisitAction, deleteVisitsAction, loadPastedSchedule, saveTranscript, updateVisitAction, warmUp } from "@/app/notes/actions";
import type { DocSummary } from "@/lib/notes/docsClient";
import { typeIcon } from "@/lib/notes/docUi";
import { DocumentDialog } from "./DocumentDialog";
import { GenerateDialog } from "./GenerateDialog";
import { RecordingConsentDialog } from "./RecordingConsentDialog";
import { Modal } from "../Modal";
import { VisitsTable } from "./VisitsTable";
import { PromoteDialog } from "./PromoteDialog";
import { normalizeTyped, formatTimeText, isTypedTimeOk, TIME_PRESETS } from "@/lib/notes/scheduleTime";
import Link from "next/link";
import { askConfirm } from "@/lib/confirm";

const shift = (iso: string, days: number) => {
  const d = new Date(`${iso}T00:00:00Z`);
  d.setUTCDate(d.getUTCDate() + days);
  return d.toISOString().slice(0, 10);
};
const longDate = (iso: string) =>
  new Date(`${iso}T00:00:00Z`).toLocaleDateString("en-US", { weekday: "long", month: "long", day: "numeric", year: "numeric", timeZone: "UTC" });

export function NotesBoard({ date, visits, canEdit, defaultProvider, embedded = false, promote = null, military = false, showProvider = false, providerOptions = [], providerFilter = "" }: {
  date: string; visits: VisitRow[]; canEdit: boolean; defaultProvider: string; embedded?: boolean;
  /** Show times as 0900-1200 (a per-person choice kept in a cookie). */
  military?: boolean;
  /** Provider column, editable: providers and admins only. */
  showProvider?: boolean; providerOptions?: string[]; providerFilter?: string;
  /** Set only for an admin on staging with Promote configured (and whether their full names are on). */
  promote?: { prodUrl: string; clientId: string; fullNames: boolean } | null;
}) {
  const router = useRouter();
  const [pending, start] = useTransition();
  const [pasting, setPasting] = useState(false);
  const [adding, setAdding] = useState(false);
  const [picked, setPicked] = useState<string[]>([]);
  const selected = picked.filter((id) => visits.some((v) => v.id === id));
  const [note, setNote] = useState("");
  const [openDoc, setOpenDoc] = useState<{ visitId: string; id: string; label: string } | null>(null);
  const [generating, setGenerating] = useState<VisitRow | null>(null);
  // Consent is asked first; Generate opens only after it is confirmed and saved for the visit.
  const [consenting, setConsenting] = useState<VisitRow | null>(null);
  // Documents just generated, shown at once; the server's list replaces them after the refresh.
  const [fresh, setFresh] = useState<Record<string, DocSummary[]>>({});
  const docsOf = (v: VisitRow): DocSummary[] => {
    const server: DocSummary[] = v.documents.map((d) => ({ id: d.id, docType: d.kind, title: d.label, latestVersion: d.latestVersion ?? 0 }));
    const extra = (fresh[v.id] ?? []).filter((f) => !server.some((s) => s.id === f.id));
    return [...server.map((s) => fresh[v.id]?.find((f) => f.id === s.id) ?? s), ...extra];
  };
  const [reading, setReading] = useState<string | null>(null);
  const [pasteFor, setPasteFor] = useState<VisitRow | null>(null);
  const [promoting, setPromoting] = useState<VisitRow | null>(null);

  const go = (d: string) => router.push(`/schedule?view=day&date=${d}`);

  return (
    <>
      <div className="row" style={{ marginBottom: ".75rem" }}>
        {!embedded && <h1 style={{ margin: 0 }}>Schedule</h1>}
        <span className="grow" />
        <button className="secondary" aria-pressed={military} title="Show times as 0900-1200" disabled={pending} onClick={() => start(async () => { await setClockStyle(!military); router.refresh(); })}>{military ? "12-hour time" : "Military time"}</button>
        <Link className="btn secondary" href={`/schedule/print?date=${date}${providerFilter ? `&provider=${encodeURIComponent(providerFilter)}` : ""}`} target="_blank">Print</Link>
        {canEdit && <button className="secondary" onClick={() => setAdding((v) => !v)}>{adding ? "Cancel" : "Add a visit"}</button>}
        {canEdit && <button className="secondary" onClick={() => setPasting((v) => !v)}>{pasting ? "Cancel" : "Paste a schedule"}</button>}
      </div>

      {!embedded && <div className="row" style={{ marginBottom: "1rem" }}>
        <button className="secondary" aria-label="Previous day" onClick={() => go(shift(date, -1))}>←</button>
        <button className="secondary" onClick={() => go(new Date().toISOString().slice(0, 10))}>Today</button>
        <button className="secondary" aria-label="Next day" onClick={() => go(shift(date, 1))}>→</button>
        <strong style={{ margin: "0 .5rem" }}>{longDate(date)}</strong>
        <input type="date" value={date} aria-label="Pick a date" onChange={(e) => e.target.value && go(e.target.value)} />
      </div>}

      <datalist id="visit-time-presets">{TIME_PRESETS.map((t) => <option key={t} value={t} />)}</datalist>

      {note && <div className="card" role="status">{note} <button className="link" onClick={() => setNote("")}>Dismiss</button></div>}

      {adding && <AddVisit date={date} defaultProvider={defaultProvider} onDone={(m) => { setAdding(false); setNote(m); router.refresh(); }} />}

      {pasting && <PasteSchedule date={date} defaultProvider={defaultProvider} onDone={(m) => { setPasting(false); setNote(m); router.refresh(); }} />}

      {canEdit && selected.length > 0 && (
        <div className="row" style={{ marginBottom: ".5rem" }}>
          <button
            className="secondary"
            disabled={pending}
            onClick={async () => {
              const withData = visits.filter((v) => selected.includes(v.id) && (v.hasTranscript || v.documents.length > 0)).length;
              const extra = withData ? ` The transcripts and generated documents of those visits are deleted too (${withData} have some).` : "";
              if (!(await askConfirm(`Delete ${selected.length} visit${selected.length === 1 ? "" : "s"}?${extra} This cannot be undone.`, { danger: true, confirmLabel: "Delete" }))) return;
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
        <p className="muted">No visits for this day. {canEdit && "Use “Add a visit” or “Paste a schedule” to add some."}</p>
      ) : (
        <section className="sched-card" aria-label="Visits">
        <div className="sched-strip">
          <span className="sdot"><i className="d plum" />{visits.length} visit{visits.length === 1 ? "" : "s"}</span>
          <span className="sdot"><i className="d green" />{visits.filter((v) => v.status === "seen" || v.status === "note_signed").length} seen</span>
          <span className="sdot"><i className="d blue" />{visits.filter((v) => v.status === "scheduled").length} scheduled</span>
          <span className="sdot"><i className="d amber" />{visits.filter((v) => v.documents.some((d) => d.draft)).length} documents to review</span>
        </div>
        <VisitsTable
          visits={visits}
          docsOf={docsOf}
          canEdit={canEdit}
          selected={selected}
          pending={pending}
          onSelect={(id, on) => setPicked(on ? [...selected, id] : selected.filter((i) => i !== id))}
          onSelectAll={(on) => setPicked(on ? visits.map((v) => v.id) : [])}
          onStatus={(v, status) => start(async () => {
            const r = await updateVisitAction(v.id, { status });
            if (!r.ok) setNote(r.error);
            router.refresh();
          })}
          onOpenDoc={(v, d) => setOpenDoc({ visitId: v.id, id: d.id, label: d.title })}
          onGenerate={(v) => { void warmUp(); setConsenting(v); }}
          onTranscript={(v) => setReading(v.id)}
          onPasteTranscript={(v) => setPasteFor(v)}
          onPromote={promote ? (v) => setPromoting(v) : undefined}
          promoteReason={promote ? (v) => (!v.hasTranscript ? "no transcript yet" : !promote.fullNames ? "full names are off for you" : "") : undefined}
          military={military}
          showProvider={showProvider}
          providerOptions={providerOptions}
          onProvider={showProvider && canEdit ? (v, name) => start(async () => {
            const r = await updateVisitAction(v.id, { providerName: name });
            if (!r.ok) setNote(r.error);
            router.refresh();
          }) : undefined}
          onDelete={async (v) => {
            const extra = v.documents.length || v.hasTranscript ? " Its transcript and documents are deleted too." : "";
            if (!(await askConfirm(`Delete the visit for ${v.initials}?${extra} This cannot be undone.`, { danger: true, confirmLabel: "Delete" }))) return;
            start(async () => {
              const r = await deleteVisitAction(v.id);
              setNote(r.ok ? "Visit deleted." : r.error);
              router.refresh();
            });
          }}
          renderTime={(v) => (canEdit ? <EditableTime key={`${v.id}-${v.apptTime}-${military}`} visitId={v.id} value={v.apptTime} military={military} onError={setNote} onSaved={() => router.refresh()} /> : v.apptTime)}
        />
        <div className="sched-foot">{visits.length} visit{visits.length === 1 ? "" : "s"} · Timed visits first, then time blocks</div>
        </section>
      )}

      {pasteFor && <TranscriptPaste visitId={pasteFor.id} onClose={() => setPasteFor(null)} onSaved={() => { setPasteFor(null); router.refresh(); }} />}

      {promoting && promote && <PromoteDialog visitId={promoting.id} who={promoting.initials} prodUrl={promote.prodUrl} clientId={promote.clientId} onClose={() => setPromoting(null)} />}

      {reading && <TranscriptView visitId={reading} canEdit={canEdit} onClose={() => setReading(null)} />}

      {consenting && (
        <RecordingConsentDialog
          visitId={consenting.id}
          onCancel={() => setConsenting(null)}
          onConfirmed={() => { setGenerating(consenting); setConsenting(null); }}
        />
      )}

      {generating && (
        <GenerateDialog
          visitId={generating.id}
          initials={generating.initials}
          appointmentType={generating.appointmentType}
          onClose={() => setGenerating(null)}
          onDone={(docs, errors) => {
            const id = generating.id;
            setFresh((f) => ({ ...f, [id]: [...(f[id] ?? []).filter((x) => !docs.some((d) => d.id === x.id)), ...docs] }));
            setGenerating(null);
            setNote(
              errors.length
                ? `Wrote ${docs.length} document${docs.length === 1 ? "" : "s"}. Could not write: ${errors.map((e) => `${e.docType} (${e.error})`).join(", ")}. You can generate those again.`
                : `Wrote ${docs.length} document${docs.length === 1 ? "" : "s"}.`,
            );
            router.refresh();
          }}
        />
      )}

      {openDoc && <DocumentDialog visitId={openDoc.visitId} docId={openDoc.id} title={openDoc.label} canEdit={canEdit} onClose={() => { setOpenDoc(null); router.refresh(); }} />}
    </>
  );
}

function TranscriptPaste({ visitId, onClose, onSaved }: { visitId: string; onClose: () => void; onSaved: () => void }) {
  const [text, setText] = useState("");
  const [saving, setSaving] = useState(false);
  return (
    <Modal
      title="Add a transcript"
      onClose={onClose}
      busy={saving}
      footer={
        <>
          <button disabled={!text.trim() || saving} onClick={async () => {
            setSaving(true);
            try { await saveTranscript(visitId, text); onSaved(); } finally { setSaving(false); }
          }}>{saving ? "Saving…" : "Save transcript"}</button>
          <button className="secondary" onClick={onClose} disabled={saving}>Cancel</button>
        </>
      }
    >
      <p className="small muted">Paste the transcript. The recorder normally sends this; this box is for testing and for a visit typed up by hand.</p>
      <textarea rows={8} value={text} onChange={(e) => setText(e.target.value)} aria-label="Transcript" style={{ width: "100%", boxSizing: "border-box" }} />
    </Modal>
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

function EditableTime({ visitId, value, military, onSaved, onError }: { visitId: string; value: string; military: boolean; onSaved: () => void; onError: (m: string) => void }) {
  const [v, setV] = useState(formatTimeText(value, military));
  return (
    <input
      list="visit-time-presets"
      value={v}
      aria-label="Appointment time"
      placeholder={military ? "1400" : "2:00 PM"}
      onChange={(e) => setV(e.target.value)}
      onBlur={async () => {
        const typed = normalizeTyped(v.trim());
        if (typed === value || v.trim() === formatTimeText(value, military)) return;
        const r = await updateVisitAction(visitId, { apptTime: typed });
        if (r.ok && "pending" in r && r.pending) {
          onError("Sent to an admin for approval. The time changes once they approve.");
          setV(formatTimeText(value, military));
        } else if (r.ok) onSaved();
        else {
          onError(r.error);
          setV(formatTimeText(value, military));
        }
      }}
    />
  );
}

function AddVisit({ date, defaultProvider, onDone }: { date: string; defaultProvider: string; onDone: (m: string) => void }) {
  // (times may be typed as 0900 or 0900-1200 too)
  const [f, setF] = useState({ apptTime: "", program: "", appointmentType: "", providerName: defaultProvider });
  const [picked, setPicked] = useState<PatientOption | null>(null);
  const [q, setQ] = useState("");
  const [results, setResults] = useState<PatientOption[]>([]);
  const [newName, setNewName] = useState({ firstName: "", lastName: "" });
  const [showNew, setShowNew] = useState(false);
  useEffect(() => {
    if (picked || q.trim().length < 2) { setResults([]); return; }
    const t = setTimeout(() => { void searchPatients(q).then(setResults).catch(() => setResults([])); }, 200);
    return () => clearTimeout(t);
  }, [q, picked]);
  const [opts, setOpts] = useState<VisitOptions | null>(null);
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState("");
  useEffect(() => {
    void withTimeout(visitOptions()).then(setOpts).catch(() => setErr("Could not load the pick lists. Close and try again, or tell the team."));
  }, []);
  const set = (k: keyof typeof f) => (e: React.ChangeEvent<HTMLInputElement | HTMLSelectElement>) => setF({ ...f, [k]: e.target.value });
  const timeOk = isTypedTimeOk(f.apptTime);
  return (
    <div className="card">
      <h2 style={{ marginTop: 0 }}>Add a visit for {longDate(date)}</h2>
      <div className="row" style={{ flexWrap: "wrap" }}>
        <div style={{ minWidth: "16rem" }}>
          {picked ? (
            <p style={{ margin: 0 }}>
              <strong>Patient:</strong> {picked.name}{picked.mrn ? ` (${picked.mrn})` : ""}{" "}
              <button type="button" onClick={() => { setPicked(null); setQ(""); }}>Change</button>
            </p>
          ) : (
            <>
              <label>Patient <input value={q} onChange={(e) => setQ(e.target.value)} placeholder="Search by name or MRN" aria-label="Search patients" /></label>
              {results.length > 0 && (
                <ul className="small" style={{ listStyle: "none", margin: ".25rem 0", padding: 0 }}>
                  {results.map((p) => (
                    <li key={p.id}><button type="button" onClick={() => setPicked(p)}>{p.name}{p.mrn ? ` (${p.mrn})` : ""}</button></li>
                  ))}
                </ul>
              )}
              {q.trim().length >= 2 && results.length === 0 && <p className="small muted" style={{ margin: ".25rem 0" }}>No match. Check the spelling, or add a new patient.</p>}
              {!showNew ? (
                <button type="button" onClick={() => setShowNew(true)}>New patient</button>
              ) : (
                <div className="row" style={{ marginTop: ".25rem" }}>
                  <input value={newName.firstName} onChange={(e) => setNewName({ ...newName, firstName: e.target.value })} placeholder="First name" aria-label="New patient first name" />
                  <input value={newName.lastName} onChange={(e) => setNewName({ ...newName, lastName: e.target.value })} placeholder="Last name" aria-label="New patient last name" />
                  <button type="button" disabled={!newName.firstName.trim() || !newName.lastName.trim()} onClick={async () => {
                    setErr("");
                    const r = await createPatient(newName);
                    if (r.ok) { setPicked(r.patient); setShowNew(false); setNewName({ firstName: "", lastName: "" }); }
                    else setErr(Object.values(r.errors)[0] ?? "Could not add the patient.");
                  }}>Add patient</button>
                </div>
              )}
            </>
          )}
        </div>
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
      <button disabled={!picked || !timeOk || busy} onClick={async () => {
        setBusy(true);
        setErr("");
        try {
          const r = await addVisitAction({ date, patientId: picked!.id, ...f, apptTime: normalizeTyped(f.apptTime.trim()) });
          if (r.ok) onDone("Visit added.");
          else setErr(r.error);
        } catch {
          // A thrown server action has its message hidden in production; keep the form open and say so.
          setErr("The visit could not be added. Your entries are still here; check them and try again.");
        } finally {
          setBusy(false);
        }
      }}>{busy ? "Adding…" : "Add visit"}</button>
    </div>
  );
}

function TranscriptView({ visitId, canEdit, onClose }: { visitId: string; canEdit: boolean; onClose: () => void }) {
  const [state, setState] = useState<{ text: string; at: string } | { error: string } | null>(null);
  const [labels, setLabels] = useState<SpeakerLabels>({});
  const [saveError, setSaveError] = useState("");
  const [copied, setCopied] = useState(false);
  const [attempt, setAttempt] = useState(0);
  useEffect(() => {
    let alive = true;
    setState(null);
    withTimeout(getVisitTranscript(visitId))
      .then((r) => { if (!alive) return; setState(r.ok ? { text: r.transcript, at: r.updatedAt } : { error: r.error }); if (r.ok) setLabels(r.labels); })
      .catch(() => { if (alive) setState({ error: TRANSCRIPT_LOAD_ERROR }); });
    return () => { alive = false; };
  }, [visitId, attempt]);
  return (
    <Modal
      title="Transcript"
      onClose={onClose}
      notices={
        (state && "error" in state ? <p role="alert" className="docdlg-bad">{state.error}</p> : undefined)
      }
      footer={
        <>
          {state && "error" in state && <button className="secondary" onClick={() => setAttempt((n) => n + 1)}>Retry</button>}
          <button className="secondary" disabled={!state || "error" in state} onClick={async () => {
            if (state && "text" in state) {
              try { await navigator.clipboard.writeText(state.text); setCopied(true); } catch { setCopied(false); }
            }
          }}>{copied ? "Copied" : "Copy"}</button>
          <button className="secondary" onClick={onClose}>Close</button>
        </>
      }
    >
      {state && "text" in state && <p className="small muted" style={{ margin: 0 }}>Uploaded to the cloud · {new Date(state.at).toLocaleString("en-US", { timeZone: "America/Los_Angeles" })}. Read-only.</p>}
      {!state && <p className="muted">Loading…</p>}
      {state && "text" in state && (hasSpeakers(parseTurns(state.text))
        ? <div style={{ userSelect: "text", display: "grid", gap: 10 }}>
            {canEdit && (
              <div style={{ display: "flex", flexWrap: "wrap", gap: 8, alignItems: "center" }}>
                <span className="small muted">Who is who:</span>
                {[...new Set(parseTurns(state.text).map((t) => t.speaker).filter(Boolean))].map((sp) => (
                  <label key={sp} className="small" style={{ display: "flex", gap: 4, alignItems: "center" }}>
                    {sp}
                    <select aria-label={`Who is ${sp}`} value={labels[sp] ?? sp} onChange={async (e) => {
                      const next = { ...labels }; if (e.target.value === sp) delete next[sp]; else next[sp] = e.target.value;
                      const r = await saveSpeakerLabels(visitId, next);
                      if (r.ok) { setLabels(r.labels); setSaveError(""); } else setSaveError(r.error);
                    }}>
                      <option value={sp}>{sp}</option>
                      {["Provider", "Patient"].filter((o) => o !== sp).map((o) => <option key={o} value={o}>{o}</option>)}
                    </select>
                  </label>
                ))}
                {saveError && <span role="alert" className="docdlg-bad small">{saveError}</span>}
              </div>
            )}
            {applyLabels(parseTurns(state.text), labels).map((t, i) => (
              <div key={i} data-role={speakerRole(t.speaker)}>
                {t.speaker && <div className="small" style={{ fontWeight: 600 }}>{t.speaker}{t.time && <span className="muted" style={{ fontWeight: 400 }}> · {t.time}</span>}</div>}
                <div style={{ whiteSpace: "pre-wrap", overflowWrap: "anywhere" }}>{t.text}</div>
              </div>
            ))}
          </div>
        : <pre style={{ whiteSpace: "pre-wrap", userSelect: "text", margin: 0 }}>{state.text || "No transcript stored for this visit."}</pre>)}
    </Modal>
  );
}
