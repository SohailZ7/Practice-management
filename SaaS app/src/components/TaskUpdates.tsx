"use client";

import { useState } from "react";
import { Modal } from "./Modal";
import { PHI_WARNING, isPhiBlock } from "@/lib/phiGuard";
import { MAX_UPDATE, type TaskUpdateDTO } from "@/lib/taskTypes";
import { addTaskUpdate, markTaskUpdatesSeen } from "@/app/tasks/actions";

/** "Updates" button on a task card: a dated list plus a box to add one. The assignee sees an Update badge until they open it. */
export function TaskUpdates({ taskId, title, initial, isAssignee, canPost }: { taskId: string; title: string; initial: TaskUpdateDTO[]; isAssignee: boolean; canPost: boolean }) {
  const [list, setList] = useState(initial);
  const [open, setOpen] = useState(false);
  const [draft, setDraft] = useState("");
  const [error, setError] = useState("");
  const unseen = isAssignee && list.some((u) => !u.seen);

  const show = () => {
    setOpen(true);
    if (unseen) {
      setList((l) => l.map((u) => ({ ...u, seen: true })));
      void markTaskUpdatesSeen(taskId).catch(() => undefined);
    }
  };
  const post = async (confirmNoPhi = false) => {
    setError("");
    try {
      const r = await addTaskUpdate(taskId, draft, confirmNoPhi);
      if (isPhiBlock(r)) { setError(r.message); return; }
      setList((l) => [...l, r]);
      setDraft("");
    } catch (e) {
      setError(e instanceof Error ? e.message : "Something went wrong");
    }
  };

  if (!canPost && list.length === 0) return null;
  return (
    <>
      <button type="button" className={`upd-btn ${unseen ? "unseen" : ""}`} onClick={show} title={unseen ? "New update on this task" : "Updates on this task"} aria-label={unseen ? "New update" : "Updates"}>
        {unseen ? "Update" : list.length > 0 ? `Updates ${list.length}` : "Add update"}
      </button>
      {open && (
        <Modal title={`Updates: ${title}`} size="md" onClose={() => setOpen(false)} footer={<button className="notes-done" onClick={() => setOpen(false)}>Done</button>}>
          {list.length === 0 && <p className="muted small">No updates yet.</p>}
          <ul className="upd-list">
            {list.map((u) => (
              <li key={u.id}><strong>{u.author}</strong> <span className="muted small">{new Date(u.at).toLocaleString()}</span><div>{u.body}</div></li>
            ))}
          </ul>
          {canPost && (
            <>
              <textarea className="notes-textarea" style={{ minHeight: 80 }} maxLength={MAX_UPDATE} placeholder="Add an update…" value={draft} onChange={(e) => setDraft(e.target.value)} aria-label="New update" />
              <div className="phi-hint small muted">{PHI_WARNING}</div>
              {error && <div className="error small" role="alert">{error}</div>}
              <button type="button" onClick={() => void post()} disabled={!draft.trim()}>Add update</button>
            </>
          )}
        </Modal>
      )}
    </>
  );
}
