"use client";

import { useEffect, useRef, useState } from "react";
import { createPortal } from "react-dom";
import { MAX_NOTES } from "@/lib/taskTypes";
import { PHI_WARNING } from "@/lib/phiGuard";

/**
 * A popup for a task's notes (ported from the Todo App). Closing it, by Done, the ×, Esc or a click
 * outside, saves the text if it changed. Read-only viewers can read but not edit.
 */
export function TaskNotesDialog({
  title,
  notes,
  readOnly,
  onSave,
  onClose,
}: {
  title: string;
  notes: string;
  readOnly: boolean;
  onSave: (notes: string) => void;
  onClose: () => void;
}) {
  const [draft, setDraft] = useState(notes);
  const draftRef = useRef(draft);
  draftRef.current = draft;

  const close = () => {
    if (!readOnly && draftRef.current !== notes) onSave(draftRef.current);
    onClose();
  };

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") close();
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  });

  return createPortal(
    <div className="notes-overlay" onMouseDown={close}>
      <div className="notes-dialog" role="dialog" aria-modal="true" aria-label={`Notes for ${title}`} onMouseDown={(e) => e.stopPropagation()}>
        <div className="notes-header">
          <span className="notes-title">{title}</span>
          <button className="notes-close" onClick={close} title="Close (Esc)" aria-label="Close notes">
            ×
          </button>
        </div>
        {!readOnly && <div className="phi-hint small muted">{PHI_WARNING}</div>}
        <textarea
          className="notes-textarea"
          autoFocus
          readOnly={readOnly}
          maxLength={MAX_NOTES}
          placeholder={readOnly ? "No notes." : "Paste or type notes…"}
          value={draft}
          onChange={(e) => setDraft(e.target.value)}
          aria-label="Notes"
        />
        <div className="notes-footer">
          {readOnly && <span className="muted small">Read-only</span>}
          <button className="notes-done" onClick={close}>
            Done
          </button>
        </div>
      </div>
    </div>,
    document.body,
  );
}
