"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { documentsFor } from "@/lib/notes/documents";
import type { VisitRow } from "@/lib/notes/queries";
import { generateForVisit, loadPastedSchedule, saveTranscript, warmUp } from "@/app/notes/actions";
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
  const [note, setNote] = useState("");
  const [openDoc, setOpenDoc] = useState<{ id: string; label: string } | null>(null);
  const [busyVisit, setBusyVisit] = useState("");

  const go = (d: string) => router.push(`/notes?date=${d}`);

  return (
    <>
      <div className="row" style={{ marginBottom: ".75rem" }}>
        <h1 style={{ margin: 0 }}>Notes</h1>
        <span className="grow" />
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

      {pasting && <PasteSchedule date={date} defaultProvider={defaultProvider} onDone={(m) => { setPasting(false); setNote(m); router.refresh(); }} />}

      {visits.length === 0 ? (
        <p className="muted">No visits loaded for this day. {canEdit && "Use “Paste a schedule” to load one."}</p>
      ) : (
        <table className="xl">
          <thead>
            <tr><th>Patient</th><th>Program</th><th>Type</th><th>Documents</th><th /></tr>
          </thead>
          <tbody>
            {visits.map((v) => (
              <tr key={v.id}>
                <td title="Shown as initials">{v.initials}</td>
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
