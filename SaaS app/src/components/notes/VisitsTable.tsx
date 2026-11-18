"use client";

import type { ReactNode } from "react";
import type { VisitRow } from "@/lib/notes/queries";
import type { DocSummary } from "@/lib/notes/docsClient";
import { typeIcon } from "@/lib/notes/docUi";
import { VISIT_STATUSES, statusTone } from "@/lib/notes/visitStatus";
import { formatTimeText } from "@/lib/notes/scheduleTime";

/**
 * One line per visit: patient, time, program, type, status, documents, actions. Presentational only (no data calls), so
 * the same markup is rendered on the Schedule page and in the layout check. Text columns shorten with "…" rather than wrap
 * or scroll sideways; the full text is in the tooltip.
 */
export function VisitsTable({ visits, docsOf, canEdit, selected, pending, onSelect, onSelectAll, onStatus, onOpenDoc, onGenerate, onTranscript, onPasteTranscript, onDelete, onPromote, promoteReason, renderTime, military = false, showProvider = false, providerOptions = [], onProvider }: {
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
  /** Staging, admin only: offers "Promote to production". `promoteReason` returns why it is unavailable for a row (empty = available). */
  onPromote?: (v: VisitRow) => void;
  promoteReason?: (v: VisitRow) => string;
  renderTime?: (v: VisitRow) => ReactNode;
  /** Show times as 0900-1200 instead of 9:00 AM-12:00 PM. */
  military?: boolean;
  /** Provider column: providers and admins only. Editable when `onProvider` is given. */
  showProvider?: boolean;
  providerOptions?: string[];
  onProvider?: (v: VisitRow, name: string) => void;
}) {
  return (
    <div className="visits-wrap">
      <table className="visits">
        <colgroup>
          <col className="c-pat" />
          <col className="c-time" />
          <col className="c-prog" />
          <col className="c-type" />
          {showProvider && <col className="c-prov" />}
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
            {showProvider && <th>Provider</th>}
            <th>Status</th>
            <th>Documents</th>
            <th aria-label="Actions" />
          </tr>
        </thead>
        <tbody>
          {visits.map((v) => {
            const docs = docsOf(v);
            return (
              <tr key={v.id} className={v.trackingOnly ? "tracking-row" : undefined} title={v.trackingOnly ? "Not B&B: tracking only. Counted for volume and revenue, never billed." : undefined}>
                <td className="v-pat" title={v.fullName ? "Full name" : "Shown as initials"}>
                  <span className="v-pat-wrap">
                    {canEdit && <input type="checkbox" aria-label="Select visit" checked={selected.includes(v.id)} onChange={(e) => onSelect(v.id, e.target.checked)} />}
                    {v.fullName ?? v.initials}
                  </span>
                </td>
                <td className="v-time">{renderTime ? renderTime(v) : formatTimeText(v.apptTime, military)}</td>
                <td className="v-text" title={v.program}>{v.program}</td>
                <td className="v-text" title={v.appointmentType}>{v.appointmentType}</td>
                {showProvider && (
                  <td className="v-text" title={v.providerName}>
                    {onProvider ? (
                      <select aria-label={`Provider for ${v.initials}`} value={v.providerName} disabled={pending} onChange={(e) => onProvider(v, e.target.value)}>
                        <option value="">No provider</option>
                        {[...new Set([...providerOptions, v.providerName].filter(Boolean))].map((n) => <option key={n}>{n}</option>)}
                      </select>
                    ) : v.providerName}
                    {v.trackingOnly && <span className="pill small" style={{ marginLeft: ".3rem" }}>tracking</span>}
                  </td>
                )}
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
                      <button className="sm" disabled={!v.hasTranscript || pending || v.trackingOnly} title={v.trackingOnly ? "Tracking only: no documents are written" : v.hasTranscript ? "Choose and write this visit's documents" : "Available once the recording is complete"} onClick={() => onGenerate(v)}>
                        Generate docs
                      </button>
                    )}
                    <details className="row-menu">
                      <summary aria-label={`More actions for ${v.initials}`} title="More actions">⋯</summary>
                      <div className="row-menu-list" onClick={(e) => (e.currentTarget.parentElement as HTMLDetailsElement).removeAttribute("open")}>
                        <button className="menu-item" disabled={!v.hasTranscript} onClick={() => onTranscript(v)}>View transcript</button>
                        {canEdit && !v.trackingOnly && <button className="menu-item" onClick={() => onPasteTranscript(v)}>{v.hasTranscript ? "Replace transcript" : "Add transcript"}</button>}
                        {onPromote && <button className="menu-item" disabled={!!promoteReason?.(v) || v.trackingOnly} title={promoteReason?.(v) || "Copy this visit and its transcript to production"} onClick={() => onPromote(v)}>Promote to production{promoteReason?.(v) ? ` (${promoteReason(v)})` : ""}</button>}
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
