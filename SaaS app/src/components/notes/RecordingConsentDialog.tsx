"use client";

import { useState } from "react";
import { RECORDING_CONSENT as C } from "@/lib/consent/consentText";
import { Modal } from "../Modal";

/** The consent gate shown before a recording starts or a note is generated from a recorded transcript. Confirm stays
 *  disabled until the box is ticked; the confirmation is saved for the visit before `onConfirmed` runs. */
export function RecordingConsentDialog({ visitId, onConfirmed, onCancel, save = saveConsent }: {
  visitId: string; onConfirmed: () => void; onCancel: () => void;
  save?: (visitId: string) => Promise<boolean>;
}) {
  const [checked, setChecked] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  return (
    <Modal
      title={C.title}
      size="sm"
      busy={busy}
      onClose={onCancel}
      notices={error ? <p role="alert" className="small docdlg-bad">{error}</p> : undefined}
      footer={
        <>
          <button className="secondary" disabled={busy} onClick={onCancel}>{C.cancelLabel}</button>
          <button disabled={!checked || busy} onClick={async () => {
            setBusy(true);
            setError("");
            const ok = await save(visitId).catch(() => false);
            setBusy(false);
            if (ok) onConfirmed();
            else setError("The consent could not be saved. Try again.");
          }}>{busy ? "Saving…" : C.confirmLabel}</button>
        </>
      }
    >
      <p style={{ margin: 0 }}>{C.text}</p>
      <label style={{ display: "flex", gap: 8, alignItems: "flex-start", marginTop: 12 }}>
        <input type="checkbox" checked={checked} onChange={(e) => setChecked(e.target.checked)} />
        <span>{C.checkboxLabel}</span>
      </label>
    </Modal>
  );
}

async function saveConsent(visitId: string): Promise<boolean> {
  const res = await fetch(`/api/notes/visits/${encodeURIComponent(visitId)}/consent`, {
    method: "POST", credentials: "same-origin", headers: { "content-type": "application/json" },
    body: JSON.stringify({ given: true, textVersion: C.version, at: new Date().toISOString() }),
  });
  return res.ok;
}
