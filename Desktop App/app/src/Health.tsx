import { useState } from "react";
import { sendDiagnostics, type Session } from "./lib/api";
import type { Engine, EngineStatus, QueueItem } from "./lib/engine";
import { labelFor, type EnvironmentId } from "./lib/environments";
import { lastUploadAt, notOnVisitCount, type UploadFailure } from "./lib/queue";

const ago = (iso: string | number | null): string => {
  if (iso === null) return "never in this session";
  const t = typeof iso === "number" ? iso : new Date(iso).getTime();
  if (Number.isNaN(t)) return "unknown";
  const m = Math.max(0, Math.round((Date.now() - t) / 60000));
  return m < 1 ? "just now" : m < 60 ? `${m} min ago` : m < 2880 ? `${Math.round(m / 60)} h ago` : `${Math.round(m / 1440)} days ago`;
};

/** One place to see whether recordings are safe and where they are, with the real reason for anything stuck. */
export function Health({ status, env, session, queue, failures, retrying, onRetry }: {
  engine: Engine; status: EngineStatus; env: EnvironmentId; session: Session | null; queue: QueueItem[];
  failures: Record<string, UploadFailure>; retrying: boolean; onRetry: () => void;
}) {
  const [msg, setMsg] = useState("");
  const waiting = queue.filter((q) => q.status !== "uploaded");
  const oldest = waiting.length ? waiting[0].created_at : null;
  const signed = status.signed_in[env];
  const row = (label: string, ok: boolean, detail: string) => (
    <li data-testid="health-row"><span className={`pill ${ok ? "ok" : "bad"}`}>{ok ? "OK" : "Needs attention"}</span> <strong>{label}</strong> <span className="small">{detail}</span></li>
  );
  return (
    <div className="card" data-testid="health">
      <h2>Health</h2>
      <p className="small">Are your recordings safe? Everything here is about this Mac and the connection. No patient information is shown.</p>
      <ul className="health-list">
        {row("Signed in", !!signed, signed ? `Signed in to ${labelFor(env)}. Renewed automatically.` : `Not signed in to ${labelFor(env)}. Open Setup and sign in; recordings stay on this Mac meanwhile.`)}
        {row("Transcription model", status.whisper_model, status.whisper_model ? "Found on this Mac." : "Missing. Go to Schedule and click Download model.")}
        {row("Recordings waiting", waiting.length === 0, waiting.length === 0 ? "Nothing waiting: everything is safe on the server." : `${waiting.length} saved on this Mac, oldest ${ago(oldest)}. They send automatically; nothing is lost.`)}
        {row("Recordings not on a visit", notOnVisitCount() === 0, notOnVisitCount() === 0 ? "None: every sent recording reached its visit." : `${notOnVisitCount()} saved on the server but not added to a visit. The visit has not changed. Open Needs link in the practice app and choose Link or Append.`)}
        {row("Last upload", lastUploadAt() !== null || notOnVisitCount() === 0, lastUploadAt() === null && notOnVisitCount() > 0 ? "No recording has reached a visit yet in this session." : `Confirmed by the server ${ago(lastUploadAt())}.`)}
      </ul>
      {waiting.length > 0 && (
        <ul className="saved-list">
          {waiting.map((q) => (
            <li key={q.visit_id} className="saved-row">
              <strong>Recorded {ago(q.created_at)}</strong>{" "}
              <span className="small err">{failures[q.visit_id]?.message ?? "Waiting for its turn to send."}</span>
              {failures[q.visit_id]?.tries ? <span className="small"> Tried {failures[q.visit_id].tries} time{failures[q.visit_id].tries === 1 ? "" : "s"}, last {ago(new Date(failures[q.visit_id].lastTriedAt ?? Date.now()).toISOString())}. Kept safe on this Mac until the server confirms it.</span> : <span className="small"> Kept safe on this Mac until the server confirms it.</span>}
            </li>
          ))}
        </ul>
      )}
      <div className="row">
        <button className="secondary" disabled={retrying || waiting.length === 0} onClick={onRetry}>{retrying ? "Retrying…" : "Retry now"}</button>
        <button className="secondary" disabled={!session} onClick={() => {
          if (!session) return;
          setMsg("Sending…");
          sendDiagnostics(session, true, env)
            .then((n) => setMsg(`Sent. ${n} recent event${n === 1 ? "" : "s"} (app version, errors and status codes only).`))
            .catch(() => setMsg("Could not send. Try again in a minute."));
        }}>Send diagnostics</button>
        <span className="small">{msg || "Sends the app version, errors and status codes. No patient names, transcripts or audio."}</span>
      </div>
    </div>
  );
}
