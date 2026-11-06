import { useEffect, useState } from "react";
import { ApiFailure, fetchTranscript, pushTranscript, type Session, type Visit } from "./lib/api";
import { bucketize, hasUnconfirmed, parseTranscript, relabelText, speakersIn } from "./lib/transcriptView";
import type { Engine, QueueItem } from "./lib/engine";
import { Modal } from "./Modal";

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
  // Renaming speakers happens inside this same window (never a second pop-up on top of it).
  const [renaming, setRenaming] = useState(false);
  const [names, setNames] = useState<Record<string, string>>({});
  const [renameBusy, setRenameBusy] = useState(false);
  const [renameMsg, setRenameMsg] = useState("");
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

  const blocks = text ? parseTranscript(text) : [];
  const speakers = speakersIn(blocks);
  const canRename = !!text && speakers.length > 0 && status.phase !== "recording" && status.phase !== "working";

  async function saveNames() {
    if (!text) return;
    const map: Record<string, string> = {};
    for (const sp of speakers) if (names[sp] && names[sp] !== sp) map[sp] = names[sp];
    if (Object.keys(map).length === 0) { setRenaming(false); return; }
    setRenameBusy(true); setRenameMsg("");
    try {
      const next = relabelText(text, map);
      if (queueItem) await engine.queueSetText(queueItem.visit_id, queueItem.environment, next);
      else await pushTranscript(session, visit.id, next);
      setText(next); setRenaming(false);
    } catch (e) {
      setRenameMsg(e instanceof Error ? e.message : "Could not save the new names. Nothing was changed.");
    } finally { setRenameBusy(false); }
  }

  return (
    <Modal title={renaming ? "Rename speakers" : "Transcript"} onClose={onClose} width={720}
      footer={renaming ? (<>
        <button className="secondary" disabled={renameBusy} onClick={() => { setRenaming(false); setRenameMsg(""); }}>Back</button>
        <button disabled={renameBusy} onClick={() => void saveNames()}>{renameBusy ? "Saving…" : "Save names"}</button>
      </>) : <>
        {canRename && (
          <button className="secondary" onClick={() => { setNames(Object.fromEntries(speakers.map((sp) => [sp, sp]))); setRenameMsg(""); setRenaming(true); }}>Rename speakers</button>
        )}
        {text && (
          <button className="secondary" onClick={async () => {
            try { await navigator.clipboard.writeText(text); setCopied(true); } catch { setCopied(false); }
          }}>{copied ? "Copied" : "Copy"}</button>
        )}
        <button onClick={onClose}>Close</button>
      </>}>
      <p className="small" style={{ marginTop: 0 }}>
        <strong>{visit.initials}</strong> · {date}{visit.apptTime ? ` · ${visit.apptTime}` : ""}
        {queueItem ? ` · recorded ${new Date(queueItem.created_at).toLocaleTimeString([], { hour: "numeric", minute: "2-digit" })}` : ""}
      </p>
      <p className={info.state === "failed" ? "small err" : "small"} role="status"><strong>Status:</strong> {info.text}</p>
      {problem && <p className="small err">{problem}</p>}
      {text === "" && <p className="small">The practice app has no transcript stored for this visit.</p>}
      {text !== null && text !== "" && renaming && (
        <>
          <p className="small" style={{ marginTop: 0 }}>
            Choose who each speaker is. {visit.documentCount > 0 ? "Documents were already written from the earlier names; they are not changed. " : "Do this before writing the documents. "}
          </p>
          {speakers.map((sp) => (
            <label key={sp} className="field">
              <span>{sp}{/^Speaker \d+$/.test(sp) ? " (unconfirmed)" : ""} is</span>
              <select value={names[sp] ?? sp} onChange={(e) => setNames((n) => ({ ...n, [sp]: e.target.value }))}>
                {[...new Set(["Provider", "Patient", sp])].map((o) => <option key={o} value={o}>{o}</option>)}
              </select>
            </label>
          ))}
          {speakers.length === 2 && (
            <button className="secondary" onClick={() => setNames({ [speakers[0]]: names[speakers[1]] ?? speakers[1], [speakers[1]]: names[speakers[0]] ?? speakers[0] })}>
              Swap the two
            </button>
          )}
          {renameMsg && <p className="small err">{renameMsg}</p>}
        </>
      )}
      {text !== null && text !== "" && !renaming && (
        <>
          <p className="small">Showing the copy from: {source}{hasUnconfirmed(blocks) ? ". Speaker labels are not confirmed yet." : ""}</p>
          <div className="tx-scroll" aria-label="Transcript text" role="region" tabIndex={0}>
            {bucketize(blocks).map((bk, i) => (
              <div key={i}>
                {bk.heading && <div className="tx-bucket">{bk.heading}</div>}
                {bk.blocks.map((b, j) => (
                  <div key={j} className={`tx-block ${b.speaker.toLowerCase() === "provider" ? "provider" : b.speaker.toLowerCase() === "patient" ? "patient" : ""}`}>
                    <span className="tx-time">{b.time}</span>
                    <span className={`tx-who ${/^Speaker \d+$/.test(b.speaker) ? "unsure" : ""}`}>{b.speaker}</span>
                    <span className="tx-text">{b.text}</span>
                  </div>
                ))}
              </div>
            ))}
          </div>
        </>
      )}
    </Modal>
  );
}
