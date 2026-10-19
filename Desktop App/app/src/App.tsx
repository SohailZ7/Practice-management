import { useEffect, useMemo, useRef, useState } from "react";
import { mockSchedule } from "./lib/mockSchedule";
import { KIND_LABEL, noteKindFor, rowAction } from "./lib/noteKind";
import { draftNote } from "./lib/pipeline";
import { fillTemplate, docxText } from "./lib/docxFill";
import { noteFileName, patientFolderName } from "./lib/patientFolder";
import { getEngine, type Engine, type EngineStatus } from "./lib/engine";
import { recordingFromFile, startRecording, type Recorder } from "./lib/recorder";
import type { CaptureMode, DraftNote, ScheduleItem } from "./lib/types";

// The practice's "today" would come from the web app (America/Los_Angeles). The spike uses the device date for the mock.
const today = new Intl.DateTimeFormat("en-CA", { timeZone: "America/Los_Angeles" }).format(new Date());

type Stage =
  | { name: "board" }
  | { name: "capture"; item: ScheduleItem; mode: CaptureMode }
  | { name: "working"; item: ScheduleItem; text: string }
  | { name: "review"; item: ScheduleItem; mode: CaptureMode; transcript: string; draft: DraftNote; prior: string }
  | { name: "saved"; item: ScheduleItem; path: string };

export function App() {
  const [engine, setEngine] = useState<Engine | null>(null);
  const [status, setStatus] = useState<EngineStatus | null>(null);
  const [model, setModel] = useState("");
  const [stage, setStage] = useState<Stage>({ name: "board" });
  const [error, setError] = useState("");
  const [savedIds, setSavedIds] = useState<Set<string>>(new Set());
  const schedule = useMemo(() => mockSchedule(today), []);

  useEffect(() => {
    getEngine().then(async (e) => {
      setEngine(e);
      const s = await e.status().catch(() => null);
      setStatus(s);
      setModel(s?.models.find((m) => /qwen|llama|gemma/i.test(m)) ?? s?.models[0] ?? "");
    });
  }, []);

  const ready = !!engine && (engine.kind === "fake" || (!!status?.whisper_cli && !!status?.whisper_model && !!status?.ffmpeg && !!model));

  async function process(item: ScheduleItem, mode: CaptureMode, audio: { bytes: Uint8Array; ext: string }) {
    if (!engine) return;
    setError("");
    try {
      setStage({ name: "working", item, text: "Transcribing on this Mac…" });
      const transcript = await engine.transcribe(audio.bytes, audio.ext);
      const kind = noteKindFor(item.type);
      const folder = patientFolderName(item.patient!.lastName, item.patient!.firstName);
      let priorNote: { fileName: string; text: string } | undefined;
      if (kind !== "EVAL") {
        const names = (await engine.listNotes(folder)).filter((n) => !n.startsWith(`${today} `));
        const latest = names[names.length - 1];
        if (latest) priorNote = { fileName: latest, text: await docxText(await engine.readNote(folder, latest)) };
      }
      const draft = await draftNote({
        kind, transcript, mode, visitDate: today, typeLabel: KIND_LABEL[kind], providerName: item.provider?.name ?? "",
        patientName: `${item.patient!.lastName}, ${item.patient!.firstName}`, priorNote, llm: engine.llm(model),
        onProgress: (done, total, heading) => setStage({ name: "working", item, text: `Drafting the note: ${done} of ${total} sections (${heading.replace(/^\d+\.\s*/, "")})` }),
      });
      setStage({ name: "review", item, mode, transcript, draft, prior: priorNote?.fileName ?? "" });
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
      setStage({ name: "board" });
    }
  }

  return (
    <>
      <header className="top">
        <h1>Practice Notes</h1>
        <span className="chip">Spike · synthetic schedule</span>
        <span className="grow" />
        {engine?.kind === "fake" && <span className="chip bad">Fake engines (browser)</span>}
        {status && engine?.kind === "native" && (
          <>
            <span className={`chip ${status.whisper_cli && status.whisper_model && status.ffmpeg ? "ok" : "bad"}`}>Transcription</span>
            <span className={`chip ${status.ollama ? "ok" : "bad"}`}>Language model{model ? `: ${model}` : ""}</span>
          </>
        )}
      </header>
      <main>
        {error && <div className="banner err" role="alert">{error}</div>}
        {stage.name === "board" && (
          <Board entries={schedule.entries} savedIds={savedIds} ready={ready} models={status?.models ?? []} model={model} setModel={setModel}
            onStart={(item, mode) => setStage({ name: "capture", item, mode })} />
        )}
        {stage.name === "capture" && (
          <Capture item={stage.item} mode={stage.mode} onCancel={() => setStage({ name: "board" })} onDone={(a) => process(stage.item, stage.mode, a)} />
        )}
        {stage.name === "working" && (
          <div className="card"><h2>{stage.item.patient?.lastName}, {stage.item.patient?.firstName}</h2><p role="status">{stage.text}</p><p className="small">Nothing leaves this Mac.</p></div>
        )}
        {stage.name === "review" && engine && (
          <Review stage={stage} engine={engine} onCancel={() => setStage({ name: "board" })}
            onSaved={(path) => { setSavedIds((s) => new Set(s).add(stage.item.id)); setStage({ name: "saved", item: stage.item, path }); }} />
        )}
        {stage.name === "saved" && (
          <div className="card"><h2>Note saved</h2><p>{stage.path}</p><button onClick={() => setStage({ name: "board" })}>Back to schedule</button></div>
        )}
      </main>
    </>
  );
}

function Board({ entries, savedIds, ready, models, model, setModel, onStart }: {
  entries: ScheduleItem[]; savedIds: Set<string>; ready: boolean; models: string[]; model: string; setModel: (m: string) => void;
  onStart: (item: ScheduleItem, mode: CaptureMode) => void;
}) {
  return (
    <>
      <div className="row" style={{ marginBottom: 10 }}>
        <h2 style={{ margin: 0 }}>Today, {today}</h2><span className="grow" />
        {models.length > 1 && (
          <label className="small">Model <select value={model} onChange={(e) => setModel(e.target.value)}>{models.map((m) => <option key={m}>{m}</option>)}</select></label>
        )}
      </div>
      {!ready && <div className="banner">An engine is not ready yet. Recording is disabled until transcription and the language model are installed.</div>}
      <table className="board">
        <thead><tr><th>Time</th><th>Patient</th><th>Program</th><th>Type</th><th>Provider</th><th /></tr></thead>
        <tbody>
          {entries.map((e) => {
            const action = rowAction(e);
            return (
              <tr key={e.id} className={action === "none" ? "dim" : ""}>
                <td>{e.time}</td>
                <td>
                  {e.patient ? `${e.patient.lastName}, ${e.patient.firstName}` : e.clientInfo}{" "}
                  <span className={`badge ${e.consent === "on_file" ? "on" : ""}`}>
                    {e.consent === "on_file" ? "Consent on file" : e.consent === "none" ? "No consent" : "Not linked"}
                  </span>
                </td>
                <td>{e.program}</td><td>{e.type}</td><td>{e.provider?.name}</td>
                <td style={{ textAlign: "right" }}>
                  {savedIds.has(e.id) ? <span className="badge on">Note saved</span>
                    : action === "record" ? <button className="record" disabled={!ready} onClick={() => onStart(e, "recording")}>● Record</button>
                    : action === "dictate" ? <button className="dictate" disabled={!ready || !e.patient} onClick={() => onStart(e, "dictation")} title={e.patient ? "No consent on file: dictate a summary after the visit" : "Link a patient in the web app first"}>Dictate note</button>
                    : null}
                </td>
              </tr>
            );
          })}
        </tbody>
      </table>
      <p className="small">Consent is checked against the web app before every recording. The Record button is turned off when consent is not on file.</p>
    </>
  );
}

function Capture({ item, mode, onCancel, onDone }: {
  item: ScheduleItem; mode: CaptureMode; onCancel: () => void; onDone: (a: { bytes: Uint8Array; ext: string }) => void;
}) {
  const rec = useRef<Recorder | null>(null);
  const [secs, setSecs] = useState(0);
  const [err, setErr] = useState("");
  useEffect(() => {
    let alive = true;
    startRecording().then((r) => { if (alive) rec.current = r; else r.cancel(); }).catch((e) => setErr(`Microphone unavailable: ${e instanceof Error ? e.message : e}`));
    const t = setInterval(() => setSecs((s) => s + 1), 1000);
    return () => { alive = false; clearInterval(t); rec.current?.cancel(); };
  }, []);
  const mm = String(Math.floor(secs / 60)).padStart(2, "0"), ss = String(secs % 60).padStart(2, "0");
  return (
    <div className="card">
      <h2>{item.patient!.lastName}, {item.patient!.firstName}</h2>
      <p className="small">{mode === "recording" ? "Recording the visit. Consent is on file." : "Dictate a short summary of the visit. No patient audio is captured."}</p>
      <div className="timer"><span className="dot" />{mm}:{ss}</div>
      {err && <p className="err" role="alert">{err}</p>}
      <div className="row">
        <button onClick={async () => { if (rec.current) { const r = rec.current; rec.current = null; onDone(await r.stop()); } }} disabled={!!err}>Stop and draft note</button>
        <button className="secondary" onClick={onCancel}>Cancel</button>
        <span className="grow" />
        <label className="small">Test without a microphone: <input type="file" accept="audio/*" onChange={async (e) => { const f = e.target.files?.[0]; if (f) { rec.current?.cancel(); rec.current = null; onDone(await recordingFromFile(f)); } }} /></label>
      </div>
    </div>
  );
}

function Review({ stage, engine, onCancel, onSaved }: {
  stage: Extract<Stage, { name: "review" }>; engine: Engine; onCancel: () => void; onSaved: (path: string) => void;
}) {
  const [draft, setDraft] = useState(stage.draft);
  const [confirmed, setConfirmed] = useState<Set<string>>(new Set());
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState("");
  const must = draft.sections.filter((s) => s.mustConfirm);
  const canSave = must.every((s) => confirmed.has(s.heading)) && !busy;

  const edit = (heading: string, i: number, text: string) =>
    setDraft((d) => ({ ...d, sections: d.sections.map((s) => s.heading === heading ? { ...s, paragraphs: s.paragraphs.map((p, j) => j === i ? { ...p, text, flag: p.flag === "ungrounded" || p.flag === "not_discussed" ? p.flag : undefined } : p) } : s) }));

  async function save() {
    setBusy(true); setErr("");
    try {
      const folder = patientFolderName(stage.item.patient!.lastName, stage.item.patient!.firstName);
      const { bytes } = await fillTemplate(await engine.readTemplate(), draft);
      const existing = new Set(await engine.listNotes(folder));
      for (let tries = 0; tries < 5; tries++) {
        const name = noteFileName(today, KIND_LABEL[draft.kind], (n) => existing.has(n));
        try { onSaved(await engine.saveNote(folder, name, bytes)); return; } catch (e) { if (String(e) !== "exists" && !(e instanceof Error && e.message === "exists")) throw e; existing.add(name); }
      }
      throw new Error("Could not find a free file name");
    } catch (e) { setErr(e instanceof Error ? e.message : String(e)); setBusy(false); }
  }

  return (
    <div className="review">
      <div>
        <div className="card">
          <div className="row"><h2 style={{ margin: 0 }}>{draft.title}: {stage.item.patient!.lastName}, {stage.item.patient!.firstName}</h2><span className="grow" /><button className="secondary" onClick={onCancel}>Discard</button></div>
          <p className="small">Draft written by a local model from {stage.mode === "recording" ? "the recording" : "your dictation"}. Yellow lines were not stated or contain a value not found in the source. Review before saving.</p>
        </div>
        {draft.sections.filter((s) => s.action === "fill" || s.action === "info").map((s) => (
          <div key={s.heading} className={`card section ${s.mustConfirm ? "must" : ""}`}>
            <h3>{s.heading}</h3>
            {s.paragraphs.map((p, i) => (
              <div className="para" key={i}>
                {p.label && <label>{p.label}</label>}
                <textarea className={p.flag ? "flag" : ""} value={p.text} rows={Math.max(1, Math.ceil(p.text.length / 80))} onChange={(e) => edit(s.heading, i, e.target.value)} readOnly={s.action === "info"} aria-label={p.label ?? s.heading} />
              </div>
            ))}
            {s.mustConfirm && (
              <label className="row"><input type="checkbox" checked={confirmed.has(s.heading)} onChange={(e) => setConfirmed((c) => { const n = new Set(c); e.target.checked ? n.add(s.heading) : n.delete(s.heading); return n; })} />
                I reviewed this section and it is accurate</label>
            )}
          </div>
        ))}
        <div className="card"><p className="small">Sections the recording cannot fill (mental status exam, review of systems, formulation, diagnoses, attestation) stay as the blank template for you to complete in Word.</p>
          {err && <p className="err" role="alert">{err}</p>}
          <button disabled={!canSave} onClick={save}>{busy ? "Saving…" : "Save note as Word document"}</button>
          {!canSave && !busy && <span className="small"> Confirm the highlighted sections first.</span>}
        </div>
      </div>
      <details className="card" open><summary>Transcript</summary><div className="transcript small">{stage.transcript}</div>{stage.prior && <p className="small">Earlier note used: {stage.prior}</p>}</details>
    </div>
  );
}
