"use client";

import { useEffect, useRef, useState } from "react";
import { getDocument, saveDocument } from "@/app/notes/actions";

/**
 * The document pop-up (change request 17). It opens showing the document, the provider edits it, and closing asks
 * whether to save any changes. A document stops being a draft when the DRAFT line is deleted, which only a person
 * can do.
 */
export function DocumentEditor({ documentId, label, canEdit, onClose }: {
  documentId: string; label: string; canEdit: boolean; onClose: () => void;
}) {
  const [text, setText] = useState<string | null>(null);
  const [saved, setSaved] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const original = useRef("");

  useEffect(() => {
    let alive = true;
    getDocument(documentId)
      .then((d) => {
        if (!alive) return;
        original.current = d.markdown;
        setText(d.markdown);
        setSaved(d.markdown);
      })
      .catch((e) => setError(e instanceof Error ? e.message : String(e)));
    return () => { alive = false; };
  }, [documentId]);

  const dirty = text !== null && text !== saved;

  async function save() {
    if (text === null) return;
    setBusy(true);
    setError("");
    try {
      await saveDocument(documentId, text);
      setSaved(text);
      return true;
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
      return false;
    } finally {
      setBusy(false);
    }
  }

  async function close() {
    if (!dirty) return onClose();
    const answer = window.confirm("Save your changes to this document?");
    if (answer) {
      const ok = await save();
      if (!ok) return; // keep the pop-up open so the edit is not lost
    }
    onClose();
  }

  // Escape closes, going through the same save prompt.
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") void close();
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  });

  const isDraft = (text ?? "").includes("**DRAFT.**");

  return (
    <div className="modal-back" onClick={close}>
      <div className="modal" onClick={(e) => e.stopPropagation()}>
        <div className="row">
          <h2 style={{ margin: 0 }}>{label}</h2>
          {isDraft && <span className="badge">Draft</span>}
          <span className="grow" />
          {dirty && <span className="small muted">Unsaved changes</span>}
          <button className="secondary" onClick={close}>Close</button>
        </div>
        {error && <p className="small" style={{ color: "var(--bad, #b42318)" }}>{error}</p>}
        {text === null ? (
          <p className="muted">Loading…</p>
        ) : (
          <textarea
            value={text}
            readOnly={!canEdit}
            onChange={(e) => setText(e.target.value)}
            aria-label="Document"
            spellCheck
            style={{ width: "100%", flex: 1, minHeight: "50vh", fontFamily: "ui-monospace, Menlo, monospace", fontSize: 12.5, lineHeight: 1.5 }}
          />
        )}
        <div className="row">
          {canEdit && <button disabled={!dirty || busy} onClick={save}>{busy ? "Saving…" : "Save"}</button>}
          <a className="btn secondary" href={`/notes/${documentId}/pdf`} target="_blank" rel="noreferrer">Download PDF</a>
          <span className="grow" />
          {isDraft && <span className="small muted">Delete the DRAFT line once you have reviewed it.</span>}
        </div>
      </div>
    </div>
  );
}
