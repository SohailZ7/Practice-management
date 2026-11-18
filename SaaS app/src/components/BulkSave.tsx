"use client";

import { useEffect, useRef, useState, useTransition, type ReactNode } from "react";
import { useRouter } from "next/navigation";
import { saveAllAction } from "@/app/admin/bulk";
import { savedMessage, type BulkRow } from "@/lib/adminBulk";

/**
 * The one "Save all" pattern for every Admin tab. Wrap any number of row forms marked `data-bulk="<kind>"`; each keeps its
 * own Save button. Editing a row highlights it and enables "Save all (N)", the same place on every tab. Leaving the page with
 * unsaved edits asks first. Fields may live outside the form (the `form="id"` attribute): they are read the same way.
 */
export function BulkSave({ children }: { children: ReactNode }) {
  const root = useRef<HTMLDivElement>(null);
  const initial = useRef(new Map<HTMLFormElement, string>());
  const [dirty, setDirty] = useState<HTMLFormElement[]>([]);
  const [note, setNote] = useState<{ ok: boolean; text: string } | null>(null);
  const [pending, start] = useTransition();
  const router = useRouter();

  const forms = () => Array.from(root.current?.querySelectorAll<HTMLFormElement>("form[data-bulk]") ?? []);
  const snapshot = (f: HTMLFormElement) => JSON.stringify([...new FormData(f).entries()].map(([k, v]) => [k, typeof v === "string" ? v : ""]));
  const rowOf = (f: HTMLFormElement) => f.closest("tr, .card, .bulk-row") as HTMLElement | null;

  // Remember each row as it was rendered; again whenever the server sends fresh rows.
  useEffect(() => {
    initial.current = new Map(forms().map((f) => [f, snapshot(f)]));
    forms().forEach((f) => rowOf(f)?.classList.remove("bulk-dirty"));
    setDirty([]);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [children]); // only when the server sends fresh rows, never because the user typed

  const recheck = () => {
    const now = forms().filter((f) => initial.current.get(f) !== snapshot(f));
    forms().forEach((f) => rowOf(f)?.classList.toggle("bulk-dirty", now.includes(f)));
    setDirty(now);
  };

  useEffect(() => {
    if (dirty.length === 0) return;
    const warn = (e: BeforeUnloadEvent) => { e.preventDefault(); e.returnValue = ""; };
    window.addEventListener("beforeunload", warn);
    return () => window.removeEventListener("beforeunload", warn);
  }, [dirty.length]);

  const saveAll = () => {
    const rows: BulkRow[] = dirty.map((f) => ({
      kind: f.dataset.bulk!,
      fields: [...new FormData(f).entries()].filter((e): e is [string, string] => typeof e[1] === "string"),
    }));
    if (!window.confirm(`Save ${rows.length} ${rows.length === 1 ? "change" : "changes"}?`)) return;
    start(async () => {
      try {
        const r = await saveAllAction(rows);
        setNote({ ok: r.failed.length === 0, text: savedMessage(r) });
      } catch {
        setNote({ ok: false, text: "Could not save. Nothing was lost; try again." });
      }
      router.refresh();
    });
  };

  return (
    <div ref={root} onInput={recheck} onChange={recheck}>
      <div className="bulk-bar" role="group" aria-label="Save all changes">
        <button type="button" onClick={saveAll} disabled={dirty.length === 0 || pending}>
          {pending ? "Saving…" : dirty.length ? `Save all (${dirty.length})` : "Save all"}
        </button>
        <button type="button" className="secondary" disabled={dirty.length === 0 || pending} onClick={() => router.refresh()} title="Throw away unsaved edits">
          Discard
        </button>
        <span className="muted small">{dirty.length ? `${dirty.length} unsaved ${dirty.length === 1 ? "change" : "changes"}` : "No unsaved changes"}</span>
      </div>
      {note && (
        <div role="status" className={note.ok ? "notice" : "error"} style={{ marginBottom: ".5rem" }}>
          {note.text} <button type="button" className="link" onClick={() => setNote(null)}>Dismiss</button>
        </div>
      )}
      {children}
    </div>
  );
}
