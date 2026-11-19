"use client";

import Link from "next/link";
import { useEffect, useState } from "react";
import { createPortal } from "react-dom";
import type { EncounterRow } from "@/lib/billing/types";
import { Phi } from "@/components/Phi";
import { RowActions } from "./RowActions";

/** What the biller sees next, in plain words, for one encounter. */
export function nextStep(r: Pick<EncounterRow, "deleted" | "getixEntered" | "mrn" | "chargeCode">): string {
  if (r.deleted) return "This encounter is deleted (hidden, not erased). An administrator can restore it.";
  if (r.getixEntered) return "Entered in GetIX by hand. It is locked; an administrator can remove the mark to unlock it.";
  if (!r.mrn) return "Add the patient's MRN first. Then it is ready for manual entry into GetIX.";
  if (!r.chargeCode) return "Add a charge code or a note, then it is ready for manual entry into GetIX.";
  return "Ready for manual entry into GetIX. Entry stays a manual step; mark it entered once done.";
}

/** The Encounter review side panel from the Billing board: the facts, what happens next, and the row's actions. */
export function EncounterReview({ row, isAdmin, onClose, onDone, onError }: { row: EncounterRow; isAdmin: boolean; onClose: () => void; onDone: () => void | Promise<void>; onError: (m: string) => void }) {
  const [mounted, setMounted] = useState(false);
  useEffect(() => {
    setMounted(true);
    const onKey = (e: KeyboardEvent) => { if (e.key === "Escape") onClose(); };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [onClose]);
  if (!mounted) return null;
  return createPortal(
    <div className="drawer-back" onMouseDown={(e) => { if (e.target === e.currentTarget) onClose(); }}>
      <aside className="visit-drawer" role="dialog" aria-modal="true" aria-label="Encounter review">
        <header className="vd-head">
          <h2>Encounter review</h2>
          <button type="button" className="modal-x" onClick={onClose} aria-label="Close" title="Close (Esc)">×</button>
        </header>
        <div className="vd-body">
          <div className="vd-who">
            <div>
              <b><Phi name={row.patientName} /></b>
              <div className="small muted">{row.mrn ?? "No MRN yet"} · {row.date} · {row.program}</div>
            </div>
          </div>
          <dl className="vd-facts">
            <dt>Charge code</dt><dd>{row.chargeCode || "Needs details"}</dd>
            <dt>ICD-10</dt><dd>{row.icd10Codes.length ? row.icd10Codes.join(", ") : "None"}</dd>
            <dt>Note</dt><dd>{row.note || "None"}</dd>
            <dt>Entered by</dt><dd>{row.enteredBy}</dd>
            <dt>GetIX</dt><dd>{row.getixEntered ? `Entered ${row.getixEnteredAt ?? ""}` : "Not yet entered"}</dd>
          </dl>
          <section className="ti-card">
            <h3>What happens next</h3>
            <p className="small" style={{ margin: 0 }}>{nextStep(row)}</p>
          </section>
          <p className="small"><Link href={`/billing/patients/${row.patientId}`}>Open this patient&apos;s encounters</Link></p>
        </div>
        <footer className="vd-foot">
          <RowActions id={row.id} getixEntered={row.getixEntered} deleted={row.deleted} canChange={row.canChange} isAdmin={isAdmin} onDone={async () => { await onDone(); onClose(); }} onError={onError} />
        </footer>
      </aside>
    </div>,
    document.body,
  );
}
