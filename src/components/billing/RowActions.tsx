"use client";

import Link from "next/link";
import { useState } from "react";
import { deleteEncounter, restoreEncounter, setGetix } from "@/app/billing/actions";

type Props = {
  id: string;
  getixEntered: boolean;
  deleted: boolean;
  canChange: boolean;
  isAdmin: boolean;
  onDone: () => void | Promise<void>;
  onError: (message: string) => void;
};

export function RowActions({ id, getixEntered, deleted, canChange, isAdmin, onDone, onError }: Props) {
  const [busy, setBusy] = useState(false);

  async function run(fn: () => Promise<{ error?: string }>) {
    setBusy(true);
    try {
      const r = await fn();
      if (r.error) onError(r.error);
      else await onDone();
    } catch (e) {
      onError(e instanceof Error ? e.message : "Something went wrong");
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="row" style={{ gap: ".35rem", flexWrap: "nowrap" }}>
      {deleted ? (
        isAdmin && (
          <button className="secondary" disabled={busy} onClick={() => run(() => restoreEncounter(id))}>
            Restore
          </button>
        )
      ) : (
        <>
          {isAdmin && !getixEntered && (
            <button disabled={busy} onClick={() => run(() => setGetix(id, true))} title="Mark as entered into GetIX">
              Mark entered
            </button>
          )}
          {isAdmin && getixEntered && (
            <button className="secondary" disabled={busy} onClick={() => run(() => setGetix(id, false))} title="Remove the mark and unlock the encounter">
              Remove mark
            </button>
          )}
          {canChange && (
            <>
              <Link className="btn secondary" href={`/billing/encounters/${id}/edit`}>
                Edit
              </Link>
              <button
                className="danger"
                disabled={busy}
                onClick={() => {
                  if (window.confirm("Delete this encounter? It is hidden, not erased, and an admin can restore it.")) {
                    run(() => deleteEncounter(id));
                  }
                }}
              >
                Delete
              </button>
            </>
          )}
          {isAdmin && (
            <Link className="icon-btn" href={`/billing/history?entity=encounter&id=${id}`} title="Edit history">
              History
            </Link>
          )}
        </>
      )}
    </div>
  );
}
