import { useEffect, useState } from "react";
import { Modal } from "./Modal";
import { FormBody } from "./FormBody";
import {
  downloadDocumentPdf, fetchDocTypes, fetchDocument, listDocuments, noteErrorMessage, saveDocumentVersion,
  type DocType, type DocumentDetail, type FieldValue, type NoteDocument, type Session, type Visit,
} from "./lib/api";


/** Pick which documents to write from the transcript. The appointment type's defaults are pre-checked. */
export function GenerateDialog({ visit, session, onStart, onClose }: {
  visit: Visit; session: Session; onStart: (docTypes: string[]) => void; onClose: () => void;
}) {
  const [types, setTypes] = useState<DocType[] | null>(null);
  const [picked, setPicked] = useState<Set<string>>(new Set());
  const [error, setError] = useState("");

  useEffect(() => {
    let alive = true;
    fetchDocTypes(session, visit.appointmentType).then(
      (r) => { if (alive) { setTypes(r.docTypes); setPicked(new Set(r.docTypes.filter((t) => t.default).map((t) => t.id))); } },
      (e) => { if (alive) setError(noteErrorMessage(e)); },
    );
    return () => { alive = false; };
  }, [visit.appointmentType]);

  const toggle = (id: string, on: boolean) => setPicked((p) => { const n = new Set(p); if (on) n.add(id); else n.delete(id); return n; });

  return (
    <Modal title="Generate documents" onClose={onClose} width={520}
      footer={<>
        <button className="secondary" onClick={onClose}>Cancel</button>
        <button disabled={picked.size === 0} onClick={() => { onStart([...picked]); onClose(); }}>Generate</button>
      </>}>
      <p className="small" style={{ marginTop: 0 }}><strong>{visit.initials}</strong> · {visit.appointmentType}. Checked documents are the usual ones for this visit type; tick any others you also need.</p>
      {error && <p className="small err">{error}</p>}
      {!types && !error && <p className="small">Loading…</p>}
      {types?.map((t) => (
        <label key={t.id} style={{ display: "block", margin: "6px 0" }}>
          <input type="checkbox" checked={picked.has(t.id)} onChange={(e) => toggle(t.id, e.target.checked)} /> {t.label}
        </label>
      ))}
      <p className="small">Writing takes up to 2 minutes. You can leave this screen while it works.</p>
    </Modal>
  );
}

const sameValues = (a: Record<string, FieldValue>, b: Record<string, FieldValue>, names: string[]) =>
  names.every((n) => (a[n] ?? "") === (b[n] ?? ""));

const isOriginal = (v: { version: number; source: string }) => v.version === 1 || v.source === "model";

/** The document as an editable form. Save always creates a new version; older versions are read-only. */
export function DocumentEditor({ visit, doc, session, onClose }: {
  visit: Visit; doc: NoteDocument; session: Session; onClose: () => void;
}) {
  const [detail, setDetail] = useState<DocumentDetail | null>(null);
  const [latest, setLatest] = useState(0);
  const [values, setValues] = useState<Record<string, FieldValue>>({});
  const [error, setError] = useState("");
  const [stale, setStale] = useState(false);
  const [saving, setSaving] = useState(false);
  const [saved, setSaved] = useState("");
  const [downloading, setDownloading] = useState(false);
  const [pending, setPending] = useState<null | (() => void)>(null);

  async function load(version?: number) {
    setError(""); setStale(false); setSaved("");
    try {
      const d = await fetchDocument(session, visit.id, doc.id, version);
      setDetail(d); setValues({ ...d.current.values });
      if (!version) setLatest(d.current.version);
    } catch (e) { setError(noteErrorMessage(e)); }
  }
  useEffect(() => { void load(); }, [doc.id]);

  const readOnly = !!detail && detail.current.version !== latest;
  const names = detail?.fields.map((f) => f.name) ?? [];
  const dirty = !!detail && !readOnly && !sameValues(values, detail.current.values, names);
  const guard = (action: () => void) => (dirty ? setPending(() => action) : action());

  async function save() {
    if (!detail) return;
    setSaving(true); setError(""); setSaved(""); setStale(false);
    try {
      const r = await saveDocumentVersion(session, visit.id, doc.id, detail.current.version, values);
      await load();
      setSaved(`Saved as version ${r.version}.`);
    } catch (e) {
      setError(noteErrorMessage(e));
      if (e instanceof Error && "code" in e && (e as { code?: string }).code === "stale_version") setStale(true);
    } finally { setSaving(false); }
  }

  async function download() {
    setDownloading(true); setError(""); setSaved("");
    try {
      const path = await downloadDocumentPdf(session, visit.id, doc.id, `${visit.realInitials ?? visit.initials}_${doc.title}_v${latest}`.replace(/\s+/g, "_"));
      setSaved(`Saved the PDF (version ${latest}) to Downloads: ${path.split("/").pop()}`);
    } catch (e) { setError(e instanceof Error ? e.message : "Could not save the PDF."); }
    finally { setDownloading(false); }
  }

  const set = (name: string, v: FieldValue) => { setSaved(""); setValues((p) => ({ ...p, [name]: v })); };

  return (
    <Modal title={doc.title} onClose={() => guard(onClose)} width={1000}
      footer={pending ? (
        <>
          <span className="err" style={{ flex: "1 1 auto", alignSelf: "center" }}>You have unsaved changes.</span>
          <button className="secondary" onClick={() => { const a = pending; setPending(null); a(); }}>Discard them</button>
          <button onClick={() => setPending(null)}>Keep editing</button>
        </>
      ) : (
        <>
          {(error || saved) && (
            <span role="status" className={error ? "small err" : "small"} style={{ flex: "1 1 200px", alignSelf: "center" }}>
              {error || saved}{error && stale && <> <button className="secondary" onClick={() => void load()}>Load latest</button></>}
            </span>
          )}
          <button className="secondary" onClick={() => guard(onClose)}>Close</button>
          {detail && (
            <button className="secondary" disabled={dirty || saving || downloading}
              title={dirty ? "Save as new version first: the PDF is made from the latest saved version" : "Download the latest saved version as a PDF to your Downloads folder"}
              onClick={() => void download()}>{downloading ? "Saving PDF…" : "Download PDF"}</button>
          )}
          {detail && !readOnly && <button disabled={!dirty || saving} onClick={() => void save()}>{saving ? "Saving…" : "Save as new version"}</button>}
        </>
      )}>
      <p className="small" style={{ marginTop: 0 }}><strong>{visit.initials}</strong>{visit.apptTime ? ` · ${visit.apptTime}` : ""}</p>
      {!detail && !error && <p className="small">Loading…</p>}
      {detail && (
        <>
          <label className="field"><span>Version</span>
            <select value={detail.current.version} onChange={(e) => {
              const v = Number(e.target.value);
              guard(() => void load(v === latest ? undefined : v));
            }}>
              {[...detail.versions].sort((a, b) => b.version - a.version).map((v) => (
                <option key={v.version} value={v.version}>
                  v{v.version}{isOriginal(v) ? " · model original" : ""} · {new Date(v.createdAt).toLocaleString()}{v.authorName ? ` · ${v.authorName}` : ""}{v.version === latest ? " (latest)" : ""}
                </option>
              ))}
            </select>
          </label>
          {readOnly && <p className="small">You are reading an older version. Choose the latest version to edit.</p>}
          <FormBody fields={detail.fields} values={values} readOnly={readOnly} set={set} />
        </>
      )}
    </Modal>
  );
}

/** One button per generated document of a visit; each opens the editable form. */
export function DocumentIcons({ visit, session, refreshKey }: { visit: Visit; session: Session; refreshKey: string }) {
  const [docs, setDocs] = useState<NoteDocument[]>([]);
  const [open, setOpen] = useState<NoteDocument | null>(null);
  useEffect(() => {
    let alive = true;
    if (visit.documentCount === 0 && refreshKey === "") { setDocs([]); return; }
    listDocuments(session, visit.id).then((r) => { if (alive) setDocs(r.documents); }, () => {});
    return () => { alive = false; };
  }, [visit.id, visit.documentCount, refreshKey]);
  return (
    <>
      <span className="doc-icons">
        {docs.map((d) => (
          <button key={d.id} className="secondary doc-icon" title={`${d.title} (version ${d.latestVersion})`} aria-label={`Open ${d.title}`} onClick={() => setOpen(d)}>
            <DocIcon docType={d.docType} />
          </button>
        ))}
      </span>
      {open && <DocumentEditor visit={visit} doc={open} session={session} onClose={() => setOpen(null)} />}
    </>
  );
}

/** One distinct small picture per kind of document, so a row shows them in a line. The tooltip carries the full name. */
export function DocIcon({ docType }: { docType: string }) {
  const t = docType.toLowerCase();
  const common = { width: 16, height: 16, viewBox: "0 0 16 16", "aria-hidden": true, fill: "none", stroke: "currentColor", strokeWidth: 1.5, strokeLinecap: "round", strokeLinejoin: "round" } as const;
  if (/discharge/.test(t)) return <svg {...common}><path d="M3 2.5h6v11H3z" /><path d="M9 8h5M12 5.5 14.5 8 12 10.5" /></svg>;
  if (/admit/.test(t)) return <svg {...common}><path d="M7 2.5h6v11H7z" /><path d="M1.5 8H9M6.5 5.5 9 8l-2.5 2.5" /></svg>;
  if (/eval/.test(t)) return <svg {...common}><path d="M3 1.5h7l3 3V14.5H3z" /><circle cx="8" cy="9" r="2.2" /><path d="m9.7 10.7 2 2" /></svg>;
  return <svg {...common}><path d="M3 1.5h7l3 3V14.5H3z" /><path d="M10 1.5v3h3M5.5 8.5h5M5.5 11h5" /></svg>;
}
