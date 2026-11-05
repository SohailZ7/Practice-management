"use client";

import { useEffect, useRef, useState } from "react";
import { docsApi as defaultApi, type DocsApi, type DocSummary, type DocType } from "@/lib/notes/docsClient";
import { defaultSelection, generateErrorMessage, toggleSelection, typeLabel } from "@/lib/notes/docUi";

/** Chooser for which documents to write, then a progress state while the model works (up to about two minutes). */
export function GenerateDialog({ visitId, initials, appointmentType, onDone, onClose, api = defaultApi }: {
  visitId: string; initials: string; appointmentType: string;
  onDone: (docs: DocSummary[], errors: { docType: string; error: string }[]) => void; onClose: () => void; api?: DocsApi;
}) {
  const [types, setTypes] = useState<DocType[] | null>(null);
  const [sel, setSel] = useState<string[]>([]);
  const [phase, setPhase] = useState<"choose" | "working">("choose");
  const [error, setError] = useState("");
  const [secs, setSecs] = useState(0);
  const alive = useRef(true);

  useEffect(() => {
    alive.current = true;
    api.docTypes(appointmentType)
      .then((t) => { if (alive.current) { setTypes(t); setSel(defaultSelection(t)); } })
      .catch(() => alive.current && setError("Could not load the document types. Close and try again."));
    return () => { alive.current = false; };
  }, [api, appointmentType]);

  useEffect(() => {
    if (phase !== "working") return;
    const t = setInterval(() => setSecs((s) => s + 1), 1000);
    return () => clearInterval(t);
  }, [phase]);

  async function run() {
    setPhase("working");
    setSecs(0);
    setError("");
    try {
      const r = await api.generate(visitId, sel);
      if (!alive.current) return;
      onDone(r.documents ?? [], (r.errors ?? []).map((e) => ({ docType: e.docType, error: e.error })));
    } catch (e) {
      if (!alive.current) return;
      setError(generateErrorMessage(e));
      setPhase("choose");
    }
  }

  const working = phase === "working";
  return (
    <div className="modal-back" onClick={() => !working && onClose()}>
      <div className="modal docdlg-small" role="dialog" aria-label="Generate documents" onClick={(e) => e.stopPropagation()}>
        <h2 style={{ margin: 0 }}>Generate documents</h2>
        <p className="small muted">Visit for {initials} · {appointmentType || "no type"}</p>
        {error && <p role="alert" className="small docdlg-bad">{error}</p>}
        {!types && !error && <p className="muted">Loading…</p>}
        {types && !working && (
          <fieldset className="docdlg-types">
            <legend className="small muted">Documents to write</legend>
            {types.length === 0 && <p className="muted small">No documents are set up for this appointment type.</p>}
            {types.map((t) => (
              <label key={t.id}>
                <input type="checkbox" checked={sel.includes(t.id)} onChange={() => setSel(toggleSelection(sel, t.id))} /> {t.label}
                {t.default && <span className="small muted"> · usual for this visit</span>}
              </label>
            ))}
          </fieldset>
        )}
        {working && (
          <div role="status" aria-live="polite">
            <p><span className="spinner" aria-hidden /> Writing {sel.map((s) => typeLabel(types ?? [], s)).join(", ") || "documents"}… {secs}s</p>
            <p className="small muted">This can take up to about 2 minutes. Keep this window open; nothing is lost if it fails.</p>
          </div>
        )}
        <div className="row">
          {!working && <button disabled={!types || sel.length === 0} onClick={() => void run()}>{sel.length > 1 ? `Generate ${sel.length} documents` : "Generate"}</button>}
          <button className="secondary" disabled={working} onClick={onClose}>Cancel</button>
        </div>
      </div>
    </div>
  );
}
