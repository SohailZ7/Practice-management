"use client";

import { useEffect, useState, type ReactNode } from "react";
import { createPortal } from "react-dom";
import type { VisitRow } from "@/lib/notes/queries";
import type { DocSummary } from "@/lib/notes/docsClient";
import { typeIcon } from "@/lib/notes/docUi";
import { VISIT_STATUSES, statusTone } from "@/lib/notes/visitStatus";
import { Phi } from "@/components/Phi";

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
  const name = visit.fullName ?? visit.initials;
  return createPortal(
    <div className="drawer-back" onMouseDown={(e) => { if (e.target === e.currentTarget) onClose(); }}>
      <aside className="visit-drawer" role="dialog" aria-modal="true" aria-label="Visit details">
        <header className="vd-head">
          <h2>Visit details</h2>
          <button type="button" className="modal-x" onClick={onClose} aria-label="Close" title="Close (Esc)">×</button>
        </header>
        <div className="vd-body">
          <div className="vd-who">
            <span className="avatar" aria-hidden="true">{name.replace(/[^A-Za-z]/g, "").slice(0, 2).toUpperCase()}</span>
            <div>
              <b><Phi name={name} /></b>
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
