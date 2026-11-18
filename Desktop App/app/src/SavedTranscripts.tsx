import { useState } from "react";
import { Modal } from "./Modal";
import type { Engine, QueueItem } from "./lib/engine";
import { labelFor, type EnvironmentId } from "./lib/environments";
import { isOtherEnvironment, OTHER_ENV_MESSAGE, type UploadFailure } from "./lib/queue";

const KEPT_KEY = "kept-test-env-transcripts";
const readKept = (): string[] => { try { return JSON.parse(localStorage.getItem(KEPT_KEY) ?? "[]") as string[]; } catch { return []; } };
const writeKept = (ids: string[]) => { try { localStorage.setItem(KEPT_KEY, JSON.stringify(ids)); } catch { /* not remembered */ } };

const when = (item: QueueItem) => {
  const d = new Date(item.created_at);
  const t = Number.isNaN(d.getTime()) ? item.created_at : d.toLocaleString([], { dateStyle: "medium", timeStyle: "short" });
  const s = Math.round(item.duration_seconds);
  return `Recorded ${t}, ${Math.floor(s / 60)}:${String(s % 60).padStart(2, "0")}`;
};

/**
 * Everything saved on this Mac that has not been sent, with the real reason and a way out for each one. Nothing here is
 * ever deleted automatically: Export writes a plain-text file to Downloads and keeps the saved copy, Keep leaves it,
 * and Discard (after a confirmation) is the only thing that removes it. No patient names are shown, only date and length.
 */
export function SavedTranscripts({ engine, queue, failures, retrying, onRetry, onSignIn, onChanged }: {
  engine: Engine; queue: QueueItem[]; failures: Record<string, UploadFailure>; retrying: boolean;
  onRetry: () => void; onSignIn: (env: EnvironmentId) => void; onChanged: () => void;
}) {
  const [kept, setKept] = useState<string[]>(readKept);
  const [note, setNote] = useState<Record<string, string>>({});
  const [discard, setDiscard] = useState<QueueItem | null>(null);
  const [busy, setBusy] = useState(false);
  const other = queue.filter(isOtherEnvironment);
  const normal = queue.filter((q) => !isOtherEnvironment(q));
  const keptSet = new Set(kept);
  const showOther = other.filter((q) => !keptSet.has(q.visit_id));
  const signInEnvs = [...new Set(normal.map((q) => failures[q.visit_id]).filter((f) => f?.kind === "signed_out").map((f) => f!.environment))];

  const doExport = async (item: QueueItem) => {
    try {
      const file = (await engine.exportQueued(item.visit_id)).split("/").pop();
      setNote((n) => ({ ...n, [item.visit_id]: `Saved a plain-text file in Downloads: ${file}. The copy on this Mac is kept.` }));
    }
    catch (e) { setNote((n) => ({ ...n, [item.visit_id]: e instanceof Error ? e.message : String(e) })); }
  };
  const keep = (item: QueueItem) => { const next = [...kept, item.visit_id]; setKept(next); writeKept(next); };

  const row = (item: QueueItem, reason: string | undefined, isOther: boolean) => (
    <li key={item.visit_id} className="saved-row" data-testid="saved-row">
      <div><strong>{when(item)}</strong> <span className="small">({labelFor(item.environment)})</span></div>
      {reason && <div className="small err" data-testid="saved-reason">{reason}</div>}
      <div className="row" style={{ gap: ".4rem", flexWrap: "wrap" }}>
        <button className="secondary" onClick={() => void doExport(item)}>Export</button>
        {isOther && <button className="secondary" onClick={() => keep(item)}>Keep</button>}
        <button className="secondary" onClick={() => setDiscard(item)}>Discard…</button>
      </div>
      {note[item.visit_id] && <div className="small" role="status">{note[item.visit_id]}</div>}
    </li>
  );

  return (
    <div role="status" data-testid="saved-banner">
      {normal.length > 0 && (
        <div className="queue-card" data-testid="queue-card">
          <div className="qhead"><h3>Upload queue</h3><span>{normal.length} waiting</span></div>
          <div className="qnote">
            <div>
              <strong>Saved on this Mac, nothing is lost</strong>
              {normal.length} transcript{normal.length === 1 ? " is" : "s are"} kept encrypted here and will be sent when the practice app is reachable.{" "}
              {signInEnvs.map((e) => <button key={e} className="link" onClick={() => onSignIn(e)}>Sign in to {labelFor(e)}</button>)}
            </div>
            <button disabled={retrying} onClick={onRetry}>{retrying ? "Retrying…" : "Retry all"}</button>
          </div>
          <ul className="saved-list">{normal.map((q) => row(q, failures[q.visit_id]?.message, false))}</ul>
        </div>
      )}
      {showOther.length > 0 && (
        <div className="banner" data-testid="other-env">
          {showOther.length} transcript{showOther.length === 1 ? " was" : "s were"} recorded against the test environment. {OTHER_ENV_MESSAGE}
          <ul className="saved-list">{showOther.map((q) => row(q, undefined, true))}</ul>
        </div>
      )}
      {showOther.length === 0 && other.length > 0 && (
        <div className="small">{other.length} test-environment transcript{other.length === 1 ? " is" : "s are"} kept on this Mac (not sent).{" "}
          <button className="link" onClick={() => { setKept([]); writeKept([]); }}>Show</button></div>
      )}
      {discard && (
        <Modal title="Discard this saved transcript?" onClose={() => setDiscard(null)} width={480}
          footer={<>
            <button className="secondary" onClick={() => setDiscard(null)}>Keep it</button>
            <button className="danger" disabled={busy} onClick={async () => {
              setBusy(true);
              try { await engine.queueDiscard(discard.visit_id); setDiscard(null); onChanged(); }
              finally { setBusy(false); }
            }}>Discard permanently</button>
          </>}>
          <p style={{ marginTop: 0 }}>{when(discard)} will be permanently deleted from this Mac. It was never sent to the practice app, so it cannot be recovered. Choose <strong>Export</strong> first if you might need it.</p>
        </Modal>
      )}
    </div>
  );
}
