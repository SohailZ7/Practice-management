"use client";

import { useEffect, useState, type ReactNode } from "react";
import { createPortal } from "react-dom";
import type { VisitRow } from "@/lib/notes/queries";
import type { DocSummary } from "@/lib/notes/docsClient";
import { typeIcon } from "@/lib/notes/docUi";
import { VISIT_STATUSES, statusTone } from "@/lib/notes/visitStatus";
import { PatientName } from "@/components/PatientName";
import { CHECKLIST_KINDS, isDischargeType } from "@/lib/notes/checklist";
import { NOTE_KINDS, noteKindLabel, MAX_NOTE, type VisitNoteDTO } from "@/lib/notes/visitNotes";
import { listVisitNotes, addVisitNote, setVisitNoteResolved, listChangeRequests, decideChangeRequest, listChecklist, addChecklistItem, toggleChecklistItem, removeChecklistItem, setVisitDischarged, type ChecklistDTO } from "@/app/notes/actions";

/** The Visit details side panel: everything about one visit on one screen. Presentational; actions are passed in. */
export function VisitDrawer({ visit, docs, time, canEdit, pending, onClose, onStatus, onOpenDoc, onGenerate, onTranscript }: {
  visit: VisitRow;
  docs: DocSummary[];
  time: ReactNode;
  canEdit: boolean;
  pending?: boolean;
  onClose: () => void;
  onStatus: (v: VisitRow, status: string) => void;
  onOpenDoc: (v: VisitRow, d: DocSummary) => void;
  onGenerate: (v: VisitRow) => void;
  onTranscript: (v: VisitRow) => void;
}) {
  const [mounted, setMounted] = useState(false);
  useEffect(() => {
    setMounted(true);
    const onKey = (e: KeyboardEvent) => { if (e.key === "Escape") onClose(); };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [onClose]);
  if (!mounted) return null;

  const status = VISIT_STATUSES.find((s) => s.value === visit.status)?.label ?? "Scheduled";
  return createPortal(
    <div className="drawer-back" onMouseDown={(e) => { if (e.target === e.currentTarget) onClose(); }}>
      <aside className="visit-drawer" role="dialog" aria-modal="true" aria-label="Visit details">
        <header className="vd-head">
          <h2>Visit details</h2>
          <button type="button" className="modal-x" onClick={onClose} aria-label="Close" title="Close (Esc)">×</button>
        </header>
        <div className="vd-body">
          <div className="vd-who">
            <span className="avatar" aria-hidden="true">{visit.initials.replace(/[^A-Za-z]/g, "").slice(0, 2).toUpperCase()}</span>
            <div>
              <b><PatientName initials={visit.initials} fullName={visit.fullName} /></b>
              <div className="small muted">{visit.appointmentType || "Visit"}</div>
            </div>
            <span className={`status-pill tone-${statusTone(visit.status)}`}>{status}</span>
          </div>
          <dl className="vd-facts">
            <dt>Appointment</dt><dd>{visit.visitDate}</dd>
            <dt>Time</dt><dd>{time}</dd>
            <dt>Provider</dt><dd>{visit.providerName || "No provider"}{visit.trackingOnly ? " (tracking only)" : ""}</dd>
            <dt>Program</dt><dd>{visit.program || "None"}</dd>
          </dl>
          <section>
            <h3>Documents <span className="muted small">{docs.length}</span></h3>
            {docs.length === 0 ? <p className="muted small">No documents yet.</p> : (
              <ul className="vd-docs">
                {docs.map((d) => (
                  <li key={d.id}>
                    <span aria-hidden="true">{typeIcon(d.docType)}</span>
                    <span>{d.title}{d.latestVersion ? <small className="muted"> · version {d.latestVersion}</small> : null}</span>
                    <button type="button" className="secondary sm" onClick={() => onOpenDoc(visit, d)}>Open</button>
                  </li>
                ))}
              </ul>
            )}
          </section>
          <ChangeRequests visitId={visit.id} />
          <ChecklistSection visitId={visit.id} canEdit={canEdit} discharge={isDischargeType(visit.appointmentType)} />
          <NotesSection visitId={visit.id} />
          <ConsentSection visitId={visit.id} />
          <section>
            <h3>Transcript</h3>
            <p className="small muted">{visit.hasTranscript ? "A transcript is saved for this visit." : "No transcript yet. It appears once the recording is complete."}</p>
            <button type="button" className="secondary sm" disabled={!visit.hasTranscript} onClick={() => onTranscript(visit)}>View transcript</button>
          </section>
        </div>
        {canEdit && (
          <footer className="vd-foot">
            <button type="button" className="secondary" disabled={pending || visit.status === "seen" || visit.status === "cancelled"} onClick={() => onStatus(visit, "seen")}>Mark seen</button>
            <button type="button" disabled={!visit.hasTranscript || pending || visit.trackingOnly} onClick={() => onGenerate(visit)}>Generate docs</button>
          </footer>
        )}
      </aside>
    </div>,
    document.body,
  );
}

type ConsentRow = { id: string; userEmail: string; given: boolean; textVersion: string; source: string; at: string };

/** Who confirmed recording consent for this visit, when, and which wording version they saw. */
function ConsentSection({ visitId }: { visitId: string }) {
  const [rows, setRows] = useState<ConsentRow[] | null>(null);
  useEffect(() => {
    let alive = true;
    fetch(`/api/notes/visits/${encodeURIComponent(visitId)}/consent`, { credentials: "same-origin" })
      .then((r) => (r.ok ? r.json() : { consents: [] }))
      .then((b: { consents?: ConsentRow[] }) => alive && setRows(b.consents ?? []))
      .catch(() => alive && setRows([]));
    return () => { alive = false; };
  }, [visitId]);
  return (
    <section>
      <h3>Recording consent</h3>
      {rows === null ? <p className="muted small">Loading…</p> : rows.length === 0 ? (
        <p className="muted small">No consent recorded for this visit.</p>
      ) : (
        <ul className="vd-docs">
          {rows.map((c) => (
            <li key={c.id}>
              <span>{c.given ? "Consent confirmed" : "Consent not given"} <small className="muted">· {c.userEmail} · {c.source} · {new Date(c.at).toLocaleString("en-US", { timeZone: "America/Los_Angeles" })} · wording {c.textVersion}</small></span>
            </li>
          ))}
        </ul>
      )}
    </section>
  );
}

/** Comment-style notes on this visit: author and time on each, provider and admin notes, optional resolved flag. */
function NotesSection({ visitId }: { visitId: string }) {
  const [data, setData] = useState<{ notes: VisitNoteDTO[]; allowedKinds: string[]; me: string } | null>(null);
  const [kind, setKind] = useState("general");
  const [draft, setDraft] = useState("");
  const [err, setErr] = useState("");
  const [busy, setBusy] = useState(false);
  useEffect(() => {
    let alive = true;
    listVisitNotes(visitId).then((d) => alive && setData(d)).catch(() => alive && setData({ notes: [], allowedKinds: [], me: "" }));
    return () => { alive = false; };
  }, [visitId]);
  const add = async () => {
    setBusy(true); setErr("");
    try {
      const r = await addVisitNote(visitId, kind, draft);
      if (r.ok) { setData((d) => (d ? { ...d, notes: [...d.notes, r.note] } : d)); setDraft(""); } else setErr(r.error);
    } catch { setErr("The note could not be saved. Try again."); } finally { setBusy(false); }
  };
  const toggle = async (n: VisitNoteDTO) => {
    setErr("");
    try {
      const r = await setVisitNoteResolved(n.id, !n.resolved);
      if (r.ok) setData((d) => (d ? { ...d, notes: d.notes.map((x) => (x.id === n.id ? { ...x, resolved: !n.resolved } : x)) } : d)); else setErr(r.error);
    } catch { setErr("That could not be saved. Try again."); }
  };
  return (
    <section>
      <h3>Notes {data && <span className="muted small">{data.notes.length}</span>}</h3>
      {data === null ? <p className="muted small">Loading…</p> : data.notes.length === 0 ? <p className="muted small">No notes yet.</p> : (
        <ul className="vd-docs">
          {data.notes.map((n) => (
            <li key={n.id} style={n.resolved ? { opacity: 0.6 } : undefined}>
              <span>
                <b>{n.author}</b> <small className="muted">{noteKindLabel(n.kind)} · {new Date(n.at).toLocaleString("en-US", { timeZone: "America/Los_Angeles" })}{n.resolved ? " · resolved" : ""}</small>
                <div style={{ whiteSpace: "pre-wrap" }}>{n.body}</div>
              </span>
              {data.allowedKinds.length > 0 && <button type="button" className="secondary sm" onClick={() => void toggle(n)}>{n.resolved ? "Reopen" : "Resolve"}</button>}
            </li>
          ))}
        </ul>
      )}
      {data && data.allowedKinds.length > 0 && (
        <div>
          <select value={kind} onChange={(e) => setKind(e.target.value)} aria-label="Note type">
            {NOTE_KINDS.filter((k) => data.allowedKinds.includes(k.value)).map((k) => <option key={k.value} value={k.value}>{k.label}</option>)}
          </select>
          <textarea className="notes-textarea" style={{ minHeight: 60 }} maxLength={MAX_NOTE} placeholder="Add a note, for example: patient discharged, not discharged, unplanned" value={draft} onChange={(e) => setDraft(e.target.value)} aria-label="New note" />
          {err && <div className="error small" role="alert">{err}</div>}
          <button type="button" className="secondary sm" disabled={!draft.trim() || busy} onClick={() => void add()}>{busy ? "Saving…" : "Add note"}</button>
        </div>
      )}
      {data && data.allowedKinds.length === 0 && err && <div className="error small" role="alert">{err}</div>}
    </section>
  );
}

const FIELD_LABEL: Record<string, string> = { apptTime: "Time", program: "Program", appointmentType: "Type" };

/** Staff edits to time, program or type wait here for an admin. Hidden when nothing is pending. */
function ChangeRequests({ visitId }: { visitId: string }) {
  const [data, setData] = useState<Awaited<ReturnType<typeof listChangeRequests>> | null>(null);
  const [err, setErr] = useState("");
  const load = () => listChangeRequests(visitId).then(setData).catch(() => setData({ isAdmin: false, rows: [] }));
  useEffect(() => { void load(); }, [visitId]); // eslint-disable-line react-hooks/exhaustive-deps
  if (!data || data.rows.length === 0) return null;
  const decide = async (id: string, approve: boolean) => {
    setErr("");
    try { const r = await decideChangeRequest(id, approve); if (r.ok) await load(); else setErr(r.error); } catch { setErr("That could not be saved. Try again."); }
  };
  return (
    <section>
      <h3>Changes waiting for approval <span className="muted small">{data.rows.length}</span></h3>
      <ul className="vd-docs">
        {data.rows.map((r) => (
          <li key={r.id}>
            <span>
              {Object.entries(r.patch).map(([k, v]) => `${FIELD_LABEL[k] ?? k}: ${v || "(blank)"}`).join(" · ")}
              <small className="muted"> · asked by {r.by}</small>
            </span>
            {data.isAdmin && (
              <span>
                <button type="button" className="sm" onClick={() => void decide(r.id, true)}>Approve</button>{" "}
                <button type="button" className="secondary sm" onClick={() => void decide(r.id, false)}>Reject</button>
              </span>
            )}
          </li>
        ))}
      </ul>
      {err && <div className="error small" role="alert">{err}</div>}
    </section>
  );
}

/** Documentation and Orders for this visit: completed, then sent to FFX. On a discharge visit, also Discharged yes / no. */
function ChecklistSection({ visitId, canEdit, discharge }: { visitId: string; canEdit: boolean; discharge: boolean }) {
  const [data, setData] = useState<{ items: ChecklistDTO[]; discharged: boolean | null } | null>(null);
  const [err, setErr] = useState("");
  useEffect(() => {
    let alive = true;
    listChecklist(visitId).then((d) => alive && setData(d)).catch(() => alive && setData({ items: [], discharged: null }));
    return () => { alive = false; };
  }, [visitId]);
  const run = async (fn: () => Promise<void>) => { setErr(""); try { await fn(); } catch { setErr("That could not be saved. Try again."); } };
  const replace = (i: ChecklistDTO) => setData((d) => (d ? { ...d, items: d.items.map((x) => (x.id === i.id ? i : x)) } : d));
  const toggle = (it: ChecklistDTO, field: "done" | "sentToFfx") => run(async () => {
    const r = await toggleChecklistItem(it.id, field, !it[field]);
    if (r.ok) replace(r.item); else setErr(r.error);
  });
  const add = (kind: string, label: string) => run(async () => {
    const r = await addChecklistItem(visitId, kind, label);
    if (r.ok) setData((d) => (d ? { ...d, items: [...d.items, r.item] } : d)); else setErr(r.error);
  });
  const remove = (id: string) => run(async () => {
    await removeChecklistItem(id);
    setData((d) => (d ? { ...d, items: d.items.filter((x) => x.id !== id) } : d));
  });
  const setDis = (value: boolean | null) => run(async () => {
    const r = await setVisitDischarged(visitId, value);
    if (r.ok) setData((d) => (d ? { ...d, discharged: value } : d)); else setErr(r.error ?? "Could not save.");
  });
  if (!data) return null;
  return (
    <section>
      <h3>Documentation and orders</h3>
      {discharge && (
        <p className="small" style={{ margin: "0 0 .5rem" }}>
          <b>Discharged?</b>{" "}
          {([[true, "Yes"], [false, "No"]] as const).map(([v, l]) => (
            <label key={l} style={{ marginRight: ".75rem" }}>
              <input type="radio" name={`dis-${visitId}`} checked={data.discharged === v} disabled={!canEdit} onChange={() => void setDis(v)} /> {l}
            </label>
          ))}
          {canEdit && data.discharged !== null && <button type="button" className="secondary sm" onClick={() => void setDis(null)}>Clear</button>}
        </p>
      )}
      {CHECKLIST_KINDS.map((k) => {
        const rows = data.items.filter((i) => i.kind === k.value);
        const left = k.options.filter((o) => !rows.some((r) => r.label === o));
        return (
          <div key={k.value} style={{ marginBottom: ".5rem" }}>
            <div className="small muted">{k.label}</div>
            {rows.length === 0 && <p className="small muted" style={{ margin: 0 }}>None listed.</p>}
            <ul className="vd-docs">
              {rows.map((i) => (
                <li key={i.id}>
                  <span>{i.label}</span>
                  <span className="small">
                    <label><input type="checkbox" checked={i.done} disabled={!canEdit} onChange={() => void toggle(i, "done")} /> Completed</label>{" "}
                    <label><input type="checkbox" checked={i.sentToFfx} disabled={!canEdit || !i.done} onChange={() => void toggle(i, "sentToFfx")} /> Sent to FFX</label>{" "}
                    {canEdit && <button type="button" className="secondary sm" onClick={() => void remove(i.id)} aria-label={`Remove ${i.label}`}>Remove</button>}
                  </span>
                </li>
              ))}
            </ul>
            {canEdit && left.length > 0 && (
              <select value="" onChange={(e) => e.target.value && void add(k.value, e.target.value)} aria-label={`Add ${k.label.toLowerCase()} item`}>
                <option value="">Add {k.label.toLowerCase()}…</option>
                {left.map((o) => <option key={o} value={o}>{o}</option>)}
              </select>
            )}
          </div>
        );
      })}
      {err && <div className="error small" role="alert">{err}</div>}
    </section>
  );
}
