import { useEffect, useState } from "react";
import { ApiFailure, fetchTranscript, type Session, type Visit } from "./lib/api";
import type { Engine, QueueItem } from "./lib/engine";

export type TranscriptState = "recording" | "working" | "saved" | "uploaded" | "failed" | "none";

/** What to tell the provider about where the transcript is. Pure, so it can be tested. */
export function describeTranscript(s: { phase: string; queued: boolean; hasTranscript: boolean; reason?: string }): {
  state: TranscriptState; text: string;
} {
  if (s.phase === "recording") return { state: "recording", text: "Recording. The text appears when you press Stop (nothing is saved while you talk)." };
  if (s.phase === "working") return { state: "working", text: "Turning the recording into text and sending it…" };
  if (s.phase === "failed") return { state: "failed", text: s.reason ? `Failed: ${s.reason}` : "Something failed." };
  if (s.queued) {
    return {
      state: "saved",
      text: s.phase === "saved"
        ? "Upload failed. The text is saved encrypted on this Mac and will be retried."
        : "Saved encrypted on this Mac, not uploaded yet.",
    };
  }
  if (s.phase === "sent" || s.hasTranscript) {
    return { state: "uploaded", text: "Uploaded to the cloud. The copy on this Mac was deleted after the upload was confirmed." };
  }
  return { state: "none", text: "No transcript yet for this visit." };
}

/**
 * A read-only window onto a visit's transcript: from the encrypted copy on this Mac while it exists, otherwise from the
 * practice app. The text is held in memory only while the window is open, and cannot be edited (it can be selected and
 * copied).
 */
export function TranscriptDialog({ visit, date, status, queueItem, queued, engine, session, onClose }: {
  visit: Visit; date: string; status: { phase: string; reason?: string };
  queueItem: QueueItem | undefined; queued: boolean; engine: Engine; session: Session; onClose: () => void;
}) {
  const [text, setText] = useState<string | null>(null);
  const [source, setSource] = useState("");
  const [problem, setProblem] = useState("");
  const [copied, setCopied] = useState(false);
  const info = describeTranscript({ phase: status.phase, queued, hasTranscript: visit.hasTranscript, reason: status.reason });

  useEffect(() => {
    let alive = true;
    setText(null);
    setProblem("");
    (async () => {
      if (status.phase === "recording" || status.phase === "working") return;
      try {
        if (queueItem) {
          const t = await engine.queueText(queueItem.visit_id);
          if (alive) { setText(t); setSource("This Mac (encrypted copy)"); }
        } else if (visit.hasTranscript || status.phase === "sent") {
          const r = await fetchTranscript(session, visit.id);
          if (alive) {
            setText(r.transcript);
            setSource(`The cloud (practice app)${r.updatedAt ? `, saved ${new Date(r.updatedAt).toLocaleString()}` : ""}`);
          }
        }
      } catch (e) {
        if (!alive) return;
        setProblem(
          e instanceof ApiFailure && (e.status === 404 || e.status === 405)
            ? "The practice app cannot show uploaded transcripts to the recorder yet."
            : e instanceof Error ? e.message : String(e),
        );
      }
    })();
    return () => { alive = false; setText(null); }; // nothing is kept after the window closes
  }, [visit.id, queueItem?.visit_id, status.phase, queued]);

  return (
    <div className="modal-backdrop" role="dialog" aria-modal="true" aria-label="Transcript" onClick={onClose}
      style={{ position: "fixed", inset: 0, background: "rgba(0,0,0,.4)", display: "flex", alignItems: "center", justifyContent: "center", zIndex: 50 }}>
      <div className="card" onClick={(e) => e.stopPropagation()} style={{ width: "min(720px, 92vw)", maxHeight: "86vh", overflow: "auto" }}>
        <h2 style={{ marginTop: 0 }}>Transcript</h2>
        <p className="small">
          <strong>{visit.initials}</strong> · {date}{visit.apptTime ? ` · ${visit.apptTime}` : ""}
          {queueItem ? ` · recorded ${new Date(queueItem.created_at).toLocaleTimeString([], { hour: "numeric", minute: "2-digit" })}` : ""}
        </p>
        <p className={info.state === "failed" ? "small err" : "small"} role="status"><strong>Status:</strong> {info.text}</p>
        {problem && <p className="small err">{problem}</p>}
        {text === "" && <p className="small">The practice app has no transcript stored for this visit.</p>}
        {text !== null && text !== "" && (
          <>
            <p className="small">Showing the copy from: {source}</p>
            <textarea readOnly rows={14} value={text} aria-label="Transcript text" style={{ width: "100%" }} />
          </>
        )}
        <div className="row">
          {text && (
            <button className="secondary" onClick={async () => {
              try { await navigator.clipboard.writeText(text); setCopied(true); } catch { setCopied(false); }
            }}>{copied ? "Copied" : "Copy"}</button>
          )}
          <button onClick={onClose}>Close</button>
        </div>
      </div>
    </div>
  );
}
