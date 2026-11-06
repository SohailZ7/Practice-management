"use client";

import type { ReactNode } from "react";
import type { VisitRow } from "@/lib/notes/queries";
import type { DocSummary } from "@/lib/notes/docsClient";
import { typeIcon } from "@/lib/notes/docUi";
import { VISIT_STATUSES, statusTone } from "@/lib/notes/visitStatus";

/**
 * One line per visit: patient, time, program, type, status, documents, actions. Presentational only (no data calls), so
 * the same markup is rendered on the Schedule page and in the layout check. Text columns shorten with "…" rather than wrap
 * or scroll sideways; the full text is in the tooltip.
 */
export function VisitsTable({ visits, docsOf, canEdit, selected, pending, onSelect, onSelectAll, onStatus, onOpenDoc, onGenerate, onTranscript, onPasteTranscript, onDelete, renderTime }: {
  visits: VisitRow[];
  docsOf: (v: VisitRow) => DocSummary[];
  canEdit: boolean;
  selected: string[];
  pending?: boolean;
  onSelect: (id: string, on: boolean) => void;
  onSelectAll: (on: boolean) => void;
  onStatus: (v: VisitRow, status: string) => void;
  onOpenDoc: (v: VisitRow, d: DocSummary) => void;
  onGenerate: (v: VisitRow) => void;
  onTranscript: (v: VisitRow) => void;
  onPasteTranscript: (v: VisitRow) => void;
  onDelete: (v: VisitRow) => void;
  renderTime?: (v: VisitRow) => ReactNode;
}) {
  return (
    <div className="visits-wrap">
      <table className="visits">
        <colgroup>
          <col className="c-pat" />
          <col className="c-time" />
          <col className="c-prog" />
          <col className="c-type" />
          <col className="c-status" />
          <col className="c-docs" />
          <col className="c-act" />
        </colgroup>
        <thead>
          <tr>
            <th>
              <span className="v-pat-wrap">
                {canEdit && <input type="checkbox" aria-label="Select all visits" checked={visits.length > 0 && selected.length === visits.length} onChange={(e) => onSelectAll(e.target.checked)} />}
                Patient
              </span>
            </th>
            <th>Time</th>
            <th>Program</th>
            <th>Type</th>
            <th>Status</th>
            <th>Documents</th>
            <th aria-label="Actions" />
          </tr>
        </thead>
        <tbody>
          {visits.map((v) => {
            const docs = docsOf(v);
            return (
              <tr key={v.id}>
                <td className="v-pat" title="Shown as initials">
                  <span className="v-pat-wrap">
                    {canEdit && <input type="checkbox" aria-label="Select visit" checked={selected.includes(v.id)} onChange={(e) => onSelect(v.id, e.target.checked)} />}
                    {v.initials}
                  </span>
                </td>
                <td className="v-time">{renderTime ? renderTime(v) : v.apptTime}</td>
                <td className="v-text" title={v.program}>{v.program}</td>
                <td className="v-text" title={v.appointmentType}>{v.appointmentType}</td>
                <td>
                  {canEdit ? (
                    <select className={`status-pill tone-${statusTone(v.status)}`} value={v.status} aria-label={`Status for ${v.initials}`} disabled={pending} onChange={(e) => onStatus(v, e.target.value)}>
                      {VISIT_STATUSES.map((s) => (
                        <option key={s.value} value={s.value}>{s.label}</option>
                      ))}
                    </select>
                  ) : (
                    <span className={`status-pill tone-${statusTone(v.status)}`}>{VISIT_STATUSES.find((s) => s.value === v.status)?.label ?? "Scheduled"}</span>
                  )}
                </td>
                <td>
                  <span className="v-docs">
                    {docs.length === 0 ? (
                      <span className="muted small" title="No documents yet">—</span>
                    ) : (
                      docs.map((d) => {
                        const tip = `${d.title}${d.latestVersion ? ` · version ${d.latestVersion}` : ""}`;
                        return (
                          <button key={d.id} className="secondary doc-icon" title={tip} aria-label={`Open ${tip}`} onClick={() => onOpenDoc(v, d)}>
                            {typeIcon(d.docType)}
                          </button>
                        );
                      })
                    )}
                  </span>
                </td>
                <td className="v-act">
                  <span className="v-actions">
                    {canEdit && (
                      <button className="sm" disabled={!v.hasTranscript || pending} title={v.hasTranscript ? "Choose and write this visit's documents" : "Available once the recording is complete"} onClick={() => onGenerate(v)}>
                        Generate docs
                      </button>
                    )}
                    <details className="row-menu">
                      <summary aria-label={`More actions for ${v.initials}`} title="More actions">⋯</summary>
                      <div className="row-menu-list" onClick={(e) => (e.currentTarget.parentElement as HTMLDetailsElement).removeAttribute("open")}>
                        <button className="menu-item" disabled={!v.hasTranscript} onClick={() => onTranscript(v)}>View transcript</button>
                        {canEdit && <button className="menu-item" onClick={() => onPasteTranscript(v)}>{v.hasTranscript ? "Replace transcript" : "Add transcript"}</button>}
                        {canEdit && <button className="menu-item danger" disabled={pending} onClick={() => onDelete(v)}>Delete visit</button>}
                      </div>
                    </details>
                  </span>
                </td>
              </tr>
            );
          })}
        </tbody>
      </table>
    </div>
  );
}
