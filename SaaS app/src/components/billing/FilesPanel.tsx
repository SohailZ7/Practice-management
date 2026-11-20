"use client";

import { useRouter } from "next/navigation";
import { useState } from "react";

type Row = { id: string; name: string; size: number; note: string; uploadedByEmail: string; createdAt: string };

export function FilesPanel({ rows, canEdit, isAdmin }: { rows: Row[]; canEdit: boolean; isAdmin: boolean }) {
  const router = useRouter();
  const [err, setErr] = useState("");
  const [busy, setBusy] = useState(false);
  const upload = async (e: React.FormEvent<HTMLFormElement>) => {
    e.preventDefault();
    const fd = new FormData(e.currentTarget);
    const form = e.currentTarget;
    setBusy(true); setErr("");
    try {
      const r = await fetch("/api/billing/files", { method: "POST", body: fd, credentials: "same-origin" });
      const b = (await r.json().catch(() => ({}))) as { error?: string };
      if (!r.ok) setErr(b.error ?? "The upload failed."); else { form.reset(); router.refresh(); }
    } catch { setErr("The upload failed. Try again."); } finally { setBusy(false); }
  };
  const remove = async (id: string) => {
    setErr("");
    const r = await fetch(`/api/billing/files/${id}`, { method: "DELETE", credentials: "same-origin" }).catch(() => null);
    if (r && r.ok) router.refresh(); else setErr("Could not remove the file.");
  };
  return (
    <>
      <h2>Files</h2>
      <p className="muted small">GetIX reports and other billing files, up to 5 MB each. Keep patient names out of file names.</p>
      {canEdit && (
        <form onSubmit={upload} className="card row" style={{ flexWrap: "wrap" }}>
          <input type="file" name="file" required aria-label="File" />
          <input name="note" placeholder="Note (optional)" className="grow" aria-label="Note" maxLength={200} />
          <button type="submit" disabled={busy}>{busy ? "Uploading…" : "Upload"}</button>
        </form>
      )}
      {err && <p role="alert" className="error small">{err}</p>}
      <div className="table-wrap">
        <table>
          <thead><tr><th>File</th><th>Note</th><th>Size</th><th>Added</th><th>By</th><th aria-label="Actions" /></tr></thead>
          <tbody>
            {rows.length === 0 && <tr><td colSpan={6} className="muted">No files yet.</td></tr>}
            {rows.map((r) => (
              <tr key={r.id}>
                <td><a href={`/api/billing/files/${r.id}`}>{r.name}</a></td><td>{r.note}</td><td>{r.size < 1024 * 1024 ? `${Math.max(1, Math.round(r.size / 1024))} KB` : `${(r.size / 1048576).toFixed(1)} MB`}</td><td>{r.createdAt}</td><td>{r.uploadedByEmail}</td>
                <td>{isAdmin && <button type="button" className="danger sm" onClick={() => void remove(r.id)}>Remove</button>}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </>
  );
}
