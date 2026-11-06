"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { docsApi as defaultApi, type DocsApi, type DocumentDetail, type FieldValues } from "@/lib/notes/docsClient";
import { completeValues, isDirty, modelOriginal, saveErrorOutcome, versionLabel } from "@/lib/notes/docUi";
import { DocumentForm } from "./DocumentForm";
import { Modal } from "../Modal";

/**
 * Pop-up for one generated document: the form, a version selector, Save (a new version each time), an unsaved-changes
 * guard and a PDF preview of the saved version. Older versions are read-only.
 */
export function DocumentDialog({ visitId, docId, title, canEdit, onClose, api = defaultApi }: {
  visitId: string; docId: string; title: string; canEdit: boolean; onClose: () => void; api?: DocsApi;
}) {
  const [doc, setDoc] = useState<DocumentDetail | null>(null);
  const [latest, setLatest] = useState(0); // newest version number known
  const [viewing, setViewing] = useState(0); // version shown; latest unless an older one was picked
  const [saved, setSaved] = useState<FieldValues>({});
  const [values, setValues] = useState<FieldValues>({});
  const [busy, setBusy] = useState(false);
  const [msg, setMsg] = useState<{ kind: "error" | "info"; text: string } | null>(null);
  const [stale, setStale] = useState(false);
  const [closing, setClosing] = useState(false);
  const [pdf, setPdf] = useState(false);
  const [pdfKey, setPdfKey] = useState(0);
  const [loadError, setLoadError] = useState("");

  const load = useCallback(async (version?: number) => {
    setLoadError("");
    try {
      const d = await api.get(visitId, docId, version);
      setDoc((prev) => (version && prev ? { ...prev, versions: d.versions } : d));
      const nextLatest = Math.max(...d.versions.map((x) => x.version), d.current.version);
      if (!version || version === nextLatest) setLatest(nextLatest);
      else setLatest((l) => Math.max(l, nextLatest));
      setViewing(d.current.version);
      setSaved(d.current.values);
      setValues(d.current.values);
      setStale(false);
      return d;
    } catch {
      setLoadError("Could not load this document. Close and try again.");
      return null;
    }
  }, [api, visitId, docId]);

  useEffect(() => { void load(); }, [load]);

  const fields = doc?.fields ?? [];
  const readOnly = !canEdit || viewing !== latest;
  const dirty = !!doc && !readOnly && isDirty(fields, saved, values);
  const original = doc ? modelOriginal(doc.versions) : null;

  // Leaving the page with unsaved edits.
  useEffect(() => {
    if (!dirty) return;
    const h = (e: BeforeUnloadEvent) => { e.preventDefault(); e.returnValue = ""; };
    window.addEventListener("beforeunload", h);
    return () => window.removeEventListener("beforeunload", h);
  }, [dirty]);

  const requestClose = useCallback(() => (dirty ? setClosing(true) : onClose()), [dirty, onClose]);
  const closeRef = useRef(requestClose);
  closeRef.current = requestClose;
  useEffect(() => {
    const h = (e: KeyboardEvent) => { if (e.key === "Escape") closeRef.current(); };
    window.addEventListener("keydown", h);
    return () => window.removeEventListener("keydown", h);
  }, []);

  async function save(base: number): Promise<boolean> {
    if (!doc) return false;
    setBusy(true);
    setMsg(null);
    try {
      const r = await api.saveVersion(visitId, docId, base, completeValues(fields, values));
      setSaved(values);
      setLatest(r.version);
      setViewing(r.version);
      setStale(false);
      setPdfKey((k) => k + 1);
      setDoc((d) => d && { ...d, current: { version: r.version, values }, versions: [...d.versions, { version: r.version, source: "edit", createdAt: r.createdAt }] });
      setMsg({ kind: "info", text: `Saved as version ${r.version}.` });
      return true;
    } catch (e) {
      const o = saveErrorOutcome(e, fields);
      if (o.kind === "stale") setStale(true);
      else if (o.kind === "no_changes") setMsg({ kind: "info", text: "Nothing has changed since the last saved version." });
      else if (o.kind === "error") setMsg({ kind: "error", text: o.message });
      return false;
    } finally {
      setBusy(false);
    }
  }

  async function saveOnTop() {
    // Fetch the newest version number, keep the provider's edits, and save on top of it.
    try {
      const d = await api.get(visitId, docId);
      const newest = Math.max(...d.versions.map((x) => x.version), d.current.version);
      setDoc((prev) => (prev ? { ...prev, versions: d.versions } : d));
      await save(newest);
    } catch {
      setMsg({ kind: "error", text: "Could not reach the server. Your edits are still here." });
    }
  }

  async function pick(version: number) {
    if (dirty && !window.confirm("Switching versions discards your unsaved edits. Continue?")) return;
    setMsg(null);
    setStale(false);
    if (version === latest) { await load(); return; }
    await load(version);
  }

  const noticeBlock = (
    <>
      {loadError && <p role="alert" className="small docdlg-bad">{loadError}</p>}
      {msg && <p role={msg.kind === "error" ? "alert" : "status"} className={`small${msg.kind === "error" ? " docdlg-bad" : ""}`}>{msg.text}</p>}
      {stale && (
        <div className="docdlg-note" role="alert">
          Someone saved a newer version while you were editing.{" "}
          <button className="link" onClick={() => void load()}>Reload latest (discards my edits)</button>{" "}
          <button className="link" onClick={() => void saveOnTop()} disabled={busy}>Save mine as a new version on top</button>
        </div>
      )}
      {closing && (
        <div className="docdlg-note" role="alertdialog" aria-label="Unsaved changes">
          You have unsaved changes.{" "}
          <button disabled={busy} onClick={async () => { if (await save(latest)) onClose(); else setClosing(false); }}>Save and close</button>{" "}
          <button className="secondary" onClick={onClose}>Discard</button>{" "}
          <button className="secondary" onClick={() => setClosing(false)}>Keep editing</button>
        </div>
      )}
    </>
  );
  const hasNotices = !!(loadError || msg || stale || closing);

  return (
    <Modal
      title={title}
      size="lg"
      onClose={requestClose}
      headerExtra={
        <>
          {doc && (
            <select aria-label="Version" value={viewing} onChange={(e) => void pick(Number(e.target.value))}>
              {[...doc.versions].sort((a, b) => b.version - a.version).map((v) => (
                <option key={v.version} value={v.version}>{versionLabel(v, original, latest)}</option>
              ))}
            </select>
          )}
          {dirty && <span className="small muted" role="status">Unsaved changes</span>}
        </>
      }
      notices={hasNotices ? noticeBlock : undefined}
      footer={
        <>
          <button className="secondary" onClick={() => setPdf((p) => !p)} disabled={!doc}>{pdf ? "Hide PDF" : "PDF preview"}</button>
          <a className="btn secondary" href={api.pdfUrl(visitId, docId, viewing || undefined)} target="_blank" rel="noreferrer">Download PDF</a>
          {canEdit && <button disabled={!dirty || busy} onClick={() => void save(latest)}>{busy ? "Saving…" : "Save new version"}</button>}
        </>
      }
    >
      {!doc && !loadError && <p className="muted">Loading…</p>}
      {doc && viewing !== latest && (
        <div className="docdlg-note" role="status">
          Viewing version {viewing}{viewing === original ? " (the model original)" : ""}, read-only.{" "}
          <button className="link" onClick={() => void load()}>Back to latest</button>
          {canEdit && (
            <>{" "}<button className="link" onClick={() => { const v = values; void load().then((d) => d && setValues(v)); }}>Edit from this version</button></>
          )}
        </div>
      )}
      <div className={`docdlg-body${pdf ? " with-pdf" : ""}`}>
        {doc && <DocumentForm fields={fields} values={values} readOnly={readOnly} onChange={(n, v) => setValues((cur) => ({ ...cur, [n]: v }))} />}
        {pdf && doc && (
          <div>
            <p className="small muted">Preview of the last saved version{dirty ? " (your unsaved edits are not shown)" : ""}.</p>
            <iframe key={`${pdfKey}-${viewing}`} title="PDF preview" src={api.pdfUrl(visitId, docId, viewing)} className="docdlg-pdf" />
          </div>
        )}
      </div>
    </Modal>
  );
}
