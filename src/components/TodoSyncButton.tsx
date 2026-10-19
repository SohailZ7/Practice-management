"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { syncTodoApp } from "@/app/tasks/sync-actions";

/** Admin-only: pulls the Todo App's B & BC list into this list (one-way; the Todo App is the master). */
export function TodoSyncButton({ category, lastSyncedAt }: { category: string; lastSyncedAt: string | null }) {
  const router = useRouter();
  const [busy, setBusy] = useState(false);
  const [last, setLast] = useState(lastSyncedAt);
  const [message, setMessage] = useState("");
  const [error, setError] = useState("");

  async function sync() {
    setBusy(true);
    setError("");
    setMessage("");
    try {
      const r = await syncTodoApp();
      setLast(r.at);
      setMessage(`Synced: ${r.created} new, ${r.updated} updated, ${r.removed} removed, ${r.unchanged} unchanged.`);
      router.refresh();
    } catch (e) {
      setError(e instanceof Error ? e.message : "Sync failed");
    } finally {
      setBusy(false);
    }
  }

  return (
    <span className="row" style={{ gap: ".5rem" }}>
      <button
        className="secondary"
        onClick={sync}
        disabled={busy}
        title={`Copy the Todo App's "${category}" tasks here. Changes made here to those tasks are replaced by the Todo App's version.`}
      >
        {busy ? "Syncing…" : `↻ Sync "${category}" from Todo App`}
      </button>
      <span className="muted small">
        {message || (last ? `Last synced ${new Date(last).toLocaleString()}` : "Never synced")}
      </span>
      {error && <span className="field-error">{error}</span>}
    </span>
  );
}
