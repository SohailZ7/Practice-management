import { useEffect, useState } from "react";
import { fetchDocument, listDocuments, noteErrorMessage, type NoteContent, type NoteDocument, type Session, type Visit } from "./lib/api";

/** A read-only view of a visit's generated notes, with copy. Nothing is kept after it closes. */
export function NoteDialog({ visit, date, session, focusDocId, onClose }: {
  visit: Visit; date: string; session: Session; focusDocId?: string; onClose: () => void;
}) {
  const [docs, setDocs] = useState<NoteDocument[] | null>(null);
  const [current, setCurrent] = useState<NoteContent | null>(null);
  const [error, setError] = useState("");
  const [copied, setCopied] = useState(false);

  async function open(id: string) {
    setError(""); setCopied(false);
    try { setCurrent(await fetchDocument(session, visit.id, id)); } catch (e) { setError(noteErrorMessage(e)); }
  }

  useEffect(() => {
    let alive = true;
    (async () => {
      try {
        const r = await listDocuments(session, visit.id);
        if (!alive) return;
        const sorted = [...r.documents].sort((a, b) => b.createdAt.localeCompare(a.createdAt));
        setDocs(sorted);
        const first = focusDocId ?? sorted[0]?.id;
        if (first) await open(first);
      } catch (e) { if (alive) setError(noteErrorMessage(e)); }
    })();
    return () => { alive = false; setCurrent(null); };
  }, [visit.id, focusDocId]);

  return (
    <div role="dialog" aria-modal="true" aria-label="Note" onClick={onClose}
      style={{ position: "fixed", inset: 0, background: "rgba(0,0,0,.4)", display: "flex", alignItems: "center", justifyContent: "center", zIndex: 50 }}>
      <div className="card" onClick={(e) => e.stopPropagation()} style={{ width: "min(780px, 94vw)", maxHeight: "88vh", overflow: "auto" }}>
        <h2 style={{ marginTop: 0 }}>Note</h2>
        <p className="small"><strong>{visit.initials}</strong> · {date}{visit.apptTime ? ` · ${visit.apptTime}` : ""}</p>
        {error && <p className="small err">{error}</p>}
        {docs && docs.length === 0 && !error && <p className="small">No notes yet. Press Generate on the visit.</p>}
        {docs && docs.length > 1 && (
          <label className="field"><span>Version</span>
            <select value={current?.id ?? ""} onChange={(e) => void open(e.target.value)}>
              {docs.map((d) => <option key={d.id} value={d.id}>{d.title} · {new Date(d.createdAt).toLocaleString()}</option>)}
            </select>
          </label>
        )}
        {current && (
          <>
            <p className="small"><strong>{current.title}</strong></p>
            <textarea readOnly rows={18} value={current.content} aria-label="Note text" style={{ width: "100%" }} />
          </>
        )}
        <div className="row">
          {current && (
            <button className="secondary" onClick={async () => {
              try { await navigator.clipboard.writeText(current.content); setCopied(true); } catch { setCopied(false); }
            }}>{copied ? "Copied" : "Copy"}</button>
          )}
          <button onClick={onClose}>Close</button>
        </div>
      </div>
    </div>
  );
}
