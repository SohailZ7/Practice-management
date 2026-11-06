"use client";

import { useRef, useState } from "react";
import { Modal } from "./Modal";
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

  return (
    <Modal
      title={title}
      size="md"
      onClose={close}
      notices={!readOnly ? <div className="phi-hint small muted">{PHI_WARNING}</div> : undefined}
      footer={
        <>
          {readOnly && <span className="muted small">Read-only</span>}
          <button className="notes-done" onClick={close}>Done</button>
        </>
      }
    >
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
    </Modal>
  );
}
