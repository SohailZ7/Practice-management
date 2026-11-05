import { useCallback, useEffect, useState } from "react";
import {
  cleanupFeedback, createFeedback, feedbackErrorMessage, fetchFeedback, SignedOutError, updateFeedback,
  type FeedbackItem, type FeedbackKind, type Session,
} from "./lib/api";
import type { Engine } from "./lib/engine";

type Draft = { id: string | null; kind: FeedbackKind; title: string; description: string };
const EMPTY: Draft = { id: null, kind: "FEEDBACK", title: "", description: "" };
const KIND_LABEL: Record<FeedbackKind, string> = { FEEDBACK: "Feedback", BUG: "Bug" };

export function Feedback({ engine, session, visitRecording, onSignedOut }: {
  engine: Engine; session: Session; visitRecording: boolean; onSignedOut: () => void;
}) {
  const [items, setItems] = useState<FeedbackItem[] | null>(null);
  const [draft, setDraft] = useState<Draft | null>(null);
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(false);
  const [dictating, setDictating] = useState(false);
  const [working, setWorking] = useState("");
  // The dictated text lives only here, in memory, until it is turned into a description or discarded.
  const [transcript, setTranscript] = useState("");

  const fail = (e: unknown) => {
    if (e instanceof SignedOutError) onSignedOut();
    else setError(feedbackErrorMessage(e));
  };

  const load = useCallback(async () => {
    try {
      setItems((await fetchFeedback(session)).items);
    } catch (e) {
      fail(e);
    }
  }, [session.baseUrl, session.accessToken]);

  useEffect(() => { void load(); }, [load]);

  async function startDictation() {
    setError("");
    try {
      await engine.startRecording(false);
      setDictating(true);
    } catch (e) { fail(e); }
  }

  async function stopDictation() {
    setWorking("Transcribing on this Mac…");
    try {
      setTranscript(await engine.stopDictation());
    } catch (e) { fail(e); }
    finally { setDictating(false); setWorking(""); }
  }

  async function cancelDictation() {
    await engine.cancelRecording().catch(() => {});
    setDictating(false);
  }

  async function turnIntoDescription() {
    setBusy(true);
    setError("");
    try {
      const r = await cleanupFeedback(session, transcript);
      setDraft((d) => ({ ...(d ?? EMPTY), title: r.title, description: r.description }));
      setTranscript(""); // not kept once the cleanup has been done
      if (r.possiblePhi.length)
        setError("This may contain patient information. Please check and remove it before saving.");
    } catch (e) { fail(e); }
    finally { setBusy(false); }
  }

  async function save() {
    if (!draft) return;
    setBusy(true);
    setError("");
    try {
      const body = { kind: draft.kind, title: draft.title.trim(), description: draft.description.trim() };
      if (draft.id) await updateFeedback(session, draft.id, body);
      else await createFeedback(session, body);
      setDraft(null);
      setTranscript("");
      await load();
    } catch (e) { fail(e); }
    finally { setBusy(false); }
  }

  const close = () => { setDraft(null); setTranscript(""); setError(""); };
  const canSave = !!draft && draft.title.trim() !== "" && draft.description.trim() !== "" && !busy;

  return (
    <div className="card">
      <div className="row" style={{ justifyContent: "space-between" }}>
        <h2 style={{ margin: 0 }}>Feedback</h2>
        {!draft && <button onClick={() => { setError(""); setDraft({ ...EMPTY }); }}>New feedback</button>}
      </div>
      {error && <div className="banner err" role="alert">{error}</div>}

      {draft && (
        <div style={{ marginTop: ".8rem" }}>
          <label className="field">
            <span>Type</span>
            <select value={draft.kind} onChange={(e) => setDraft({ ...draft, kind: e.target.value as FeedbackKind })}>
              <option value="FEEDBACK">Feedback</option>
              <option value="BUG">Bug</option>
            </select>
          </label>

          {!draft.id && (
            <div className="row" style={{ marginBottom: ".6rem" }}>
              {dictating ? (
                <>
                  <span className="rec"><span className="dot" />Listening…</span>
                  <button onClick={stopDictation}>Stop</button>
                  <button className="secondary" onClick={cancelDictation}>Discard</button>
                </>
              ) : (
                <button className="record" disabled={visitRecording || !!working || busy} onClick={startDictation}>
                  Dictate
                </button>
              )}
              {working && <span className="small">{working}</span>}
              {visitRecording && <span className="small">A visit is recording.</span>}
            </div>
          )}

          {transcript && (
            <div className="banner">
              <p className="small" style={{ marginTop: 0 }}>Dictation captured ({transcript.length} characters). It is held in memory only.</p>
              <div className="row">
                <button disabled={busy} onClick={turnIntoDescription}>{busy ? "Working…" : "Turn into description"}</button>
                <button className="secondary" disabled={busy} onClick={() => setTranscript("")}>Discard dictation</button>
              </div>
            </div>
          )}

          <label className="field">
            <span>Title</span>
            <input value={draft.title} maxLength={120} onChange={(e) => setDraft({ ...draft, title: e.target.value })} />
          </label>
          <label className="field">
            <span>Description</span>
            <textarea rows={6} value={draft.description} onChange={(e) => setDraft({ ...draft, description: e.target.value })} />
          </label>
          <p className="small">Do not include patient names or details.</p>
          <div className="row">
            <button disabled={!canSave} onClick={save}>{busy ? "Saving…" : "Save"}</button>
            <button className="secondary" disabled={busy || dictating} onClick={close}>Cancel</button>
          </div>
        </div>
      )}

      {items === null ? <p className="small">Loading…</p> : items.length === 0 ? <p className="small">No feedback yet.</p> : (
        <ul style={{ listStyle: "none", padding: 0, marginTop: "1rem" }}>
          {items.map((it) => (
            <li key={it.id} className="card" style={{ marginBottom: ".6rem" }}>
              <div className="row" style={{ justifyContent: "space-between" }}>
                <strong>{it.title}</strong>
                <span className="small">{KIND_LABEL[it.kind]}</span>
              </div>
              <p style={{ whiteSpace: "pre-wrap", margin: ".4rem 0" }}>{it.description}</p>
              <div className="row" style={{ justifyContent: "space-between" }}>
                <span className="small">{it.authorName} · {new Date(it.createdAt).toLocaleString()}</span>
                {it.mine && !draft && (
                  <button className="secondary" onClick={() => { setError(""); setDraft({ id: it.id, kind: it.kind, title: it.title, description: it.description }); }}>
                    Edit
                  </button>
                )}
              </div>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}
