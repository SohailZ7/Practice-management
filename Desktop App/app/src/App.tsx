import { useCallback, useEffect, useRef, useState } from "react";
import { documentsFor, canRecord } from "./lib/documents";
import { parseSchedule, type ParseResult } from "./lib/scheduleParse";
import { patientFolderName, patientInitials } from "./lib/patientFolder";
import { generateVisit } from "./lib/visit";
import { docxText } from "./lib/docxFill";
import { getEngine, type Engine, type EngineStatus, type Settings, type VisitFile } from "./lib/engine";
import { startRecording, recordingFromFile, type Recorder } from "./lib/recorder";
import type { ScheduleItem } from "./lib/types";

const practiceToday = () => new Intl.DateTimeFormat("en-CA", { timeZone: "America/Los_Angeles" }).format(new Date());
const shiftDate = (iso: string, days: number) => {
  const d = new Date(`${iso}T00:00:00Z`);
  d.setUTCDate(d.getUTCDate() + days);
  return d.toISOString().slice(0, 10);
};
const longDate = (iso: string) =>
  new Date(`${iso}T00:00:00Z`).toLocaleDateString("en-US", { weekday: "long", month: "long", day: "numeric", year: "numeric", timeZone: "UTC" });

/** Where a row is in its recording and generating cycle. */
type RowState =
  | { phase: "idle" }
  | { phase: "recording"; since: number }
  | { phase: "queued" }
  | { phase: "working"; detail: string }
  | { phase: "done" }
  | { phase: "failed"; message: string };

type Job = { item: ScheduleItem; transcript: string; date: string };

export function App() {
  const [engine, setEngine] = useState<Engine | null>(null);
  const [status, setStatus] = useState<EngineStatus | null>(null);
  const [settings, setSettings] = useState<Settings | null>(null);
  const [tab, setTab] = useState<"schedule" | "setup">("schedule");
  const [date, setDate] = useState(practiceToday);
  const [entries, setEntries] = useState<ScheduleItem[] | null>(null);
  const [rows, setRows] = useState<Record<string, RowState>>({});
  const [filesByRow, setFilesByRow] = useState<Record<string, VisitFile[]>>({});
  const [error, setError] = useState("");
  const [preview, setPreview] = useState<{ file: VisitFile; text: string; folder: string } | null>(null);
  const [pasting, setPasting] = useState(false);

  const queue = useRef<Job[]>([]);
  const running = useRef(false);

  useEffect(() => {
    getEngine().then(async (e) => {
      setEngine(e);
      const s = await e.status().catch(() => null);
      setStatus(s);
      let current = s?.settings ?? (await e.getSettings());
      // First run: pick the model that scored best on the practice's test visits, if it is installed.
      if (!current.model && s?.models.length) {
        const preferred = ["qwen2.5:14b-instruct", "qwen3:14b", "phi4", "gemma3:12b"].find((m) => s.models.includes(m));
        current = await e.setSettings({ ...current, model: preferred ?? s.models[0] });
      }
      setSettings(current);
    });
  }, []);

  // Load the day's schedule whenever the date changes.
  useEffect(() => {
    if (!engine) return;
    let alive = true;
    engine.loadSchedule(date).then((json) => {
      if (!alive) return;
      setEntries(json ? (JSON.parse(json) as ScheduleItem[]) : null);
      setRows({});
      setFilesByRow({});
      setPasting(false);
    });
    return () => { alive = false; };
  }, [engine, date]);

  const refreshFiles = useCallback(
    async (item: ScheduleItem) => {
      if (!engine || !item.patient) return;
      const folder = patientFolderName(item.patient.lastName, item.patient.firstName);
      const files = await engine.visitFiles(folder, date).catch(() => []);
      setFilesByRow((f) => ({ ...f, [item.id]: files }));
    },
    [engine, date],
  );

  useEffect(() => {
    for (const item of entries ?? []) void refreshFiles(item);
  }, [entries, refreshFiles]);

  const setRow = (id: string, state: RowState) => setRows((r) => ({ ...r, [id]: state }));

  /** Works through the queue one visit at a time: two models at once would not fit in memory. */
  const pump = useCallback(async () => {
    if (running.current || !engine || !settings) return;
    running.current = true;
    try {
      while (queue.current.length) {
        const job = queue.current[0];
        const folder = patientFolderName(job.item.patient!.lastName, job.item.patient!.firstName);
        setRow(job.item.id, { phase: "working", detail: "starting" });
        try {
          const existing = (await engine.visitFiles(folder, job.date).catch(() => [])).map((f) => f.name);
          await engine
            .saveVisitFile(folder, job.date, "transcript.txt", new TextEncoder().encode(job.transcript))
            .catch(() => "");
          await generateVisit({
            item: job.item,
            date: job.date,
            transcript: job.transcript,
            llm: engine.llm(settings.model),
            template: (name) => engine.template(name),
            priorNote: async () => {
              const p = await engine.priorNote(folder, job.date).catch(() => null);
              if (!p) return null;
              return { fileName: `${p.date}/${p.file}`, bytes: await engine.readVisitFile(folder, p.date, p.file) };
            },
            save: (f, d, file, bytes) => engine.saveVisitFile(f, d, file, bytes),
            existing,
            onProgress: ({ document, done, total, detail }) =>
              setRow(job.item.id, { phase: "working", detail: `${document} (${done + 1} of ${total}): ${detail}` }),
          });
          setRow(job.item.id, { phase: "done" });
        } catch (e) {
          setRow(job.item.id, { phase: "failed", message: e instanceof Error ? e.message : String(e) });
        }
        void refreshFiles(job.item);
        queue.current.shift();
      }
    } finally {
      running.current = false;
    }
  }, [engine, settings, refreshFiles]);

  const enqueue = (item: ScheduleItem, transcript: string) => {
    queue.current.push({ item, transcript, date });
    setRow(item.id, { phase: "queued" });
    void pump();
  };

  async function applyPaste(text: string) {
    if (!engine || !settings) return;
    const result: ParseResult = parseSchedule(text, settings.provider_name);
    if (!result.entries.length) {
      setError("Nothing was loaded. Check that you copied the header row too, and that the provider in Setup matches the sheet.");
      return;
    }
    await engine.saveSchedule(date, JSON.stringify(result.entries));
    setEntries(result.entries);
    setRows({});
    setPasting(false);
    setError(
      `Loaded ${result.summary.kept} appointment${result.summary.kept === 1 ? "" : "s"}. ` +
        `Skipped ${result.summary.skippedNoClient} without a patient` +
        (result.otherProviders.length ? `, and ${result.summary.skippedOtherProvider} for ${result.otherProviders.join(", ")}.` : "."),
    );
  }

  // What is still missing, so the banner can say it rather than Record just being dead.
  const missing: string[] = [];
  if (engine && engine.kind === "native") {
    if (!status?.ffmpeg) missing.push("ffmpeg (brew install ffmpeg)");
    if (!status?.whisper_cli) missing.push("whisper.cpp (brew install whisper-cpp)");
    if (!status?.whisper_model) missing.push("the transcription model file");
    if (!settings?.model) missing.push("a note-writing model");
  }
  const ready = !!engine && missing.length === 0;

  return (
    <>
      <header className="top">
        <h1>Practice Notes</h1>
        <nav className="tabs">
          <button className={tab === "schedule" ? "on" : ""} onClick={() => setTab("schedule")}>Schedule</button>
          <button className={tab === "setup" ? "on" : ""} onClick={() => setTab("setup")}>Setup</button>
        </nav>
      </header>
      <main>
        {error && (
          <div className="banner" role="status">
            {error} <button className="link" onClick={() => setError("")}>Dismiss</button>
          </div>
        )}
        {tab === "setup" && engine && settings && (
          <Setup engine={engine} status={status} settings={settings} onSaved={(s) => { setSettings(s); setError("Setup saved."); }} />
        )}
        {tab === "schedule" && (
          <>
            <DateBar date={date} onChange={setDate} />
            {!ready && (
              <div className="banner">
                Recording is off because {missing.join(", ")} {missing.length === 1 ? "is" : "are"} missing. Fix it in{" "}
                <button className="link" onClick={() => setTab("setup")}>Setup</button>.
              </div>
            )}
            {pasting || !entries ? (
              <PasteSchedule
                date={date}
                provider={settings?.provider_name ?? ""}
                onCancel={entries ? () => setPasting(false) : undefined}
                onPaste={applyPaste}
              />
            ) : (
              <Board
                entries={entries}
                rows={rows}
                files={filesByRow}
                ready={ready}
                onRePaste={() => setPasting(true)}
                onRecorded={enqueue}
                onState={setRow}
                onError={setError}
                onOpen={async (item, file) => {
                  const folder = patientFolderName(item.patient!.lastName, item.patient!.firstName);
                  try {
                    const raw = await engine!.readVisitFile(folder, date, file.name);
                    const text = file.name.endsWith(".docx") ? await docxText(raw) : new TextDecoder().decode(raw);
                    setPreview({ file, text, folder });
                  } catch (e) {
                    setError(e instanceof Error ? e.message : String(e));
                  }
                }}
              />
            )}
          </>
        )}
      </main>
      {preview && engine && (
        <Preview
          preview={preview}
          onClose={() => setPreview(null)}
          onReveal={() => engine.reveal(preview.file.path).catch((e) => setError(String(e)))}
          onOpenInWord={() => engine.openFile(preview.file.path).catch((e) => setError(String(e)))}
          onMarkReviewed={async () => {
            try {
              await engine.markReviewed(preview.folder, date, preview.file.name);
              setPreview(null);
              for (const item of entries ?? []) void refreshFiles(item);
            } catch (e) {
              setError(e instanceof Error ? e.message : String(e));
            }
          }}
        />
      )}
    </>
  );
}

function DateBar({ date, onChange }: { date: string; onChange: (d: string) => void }) {
  return (
    <div className="datebar">
      <button className="secondary" aria-label="Previous day" onClick={() => onChange(shiftDate(date, -1))}>&lt;</button>
      <strong>{longDate(date)}</strong>
      <input type="date" value={date} aria-label="Pick a date" onChange={(e) => e.target.value && onChange(e.target.value)} />
      <button className="secondary" aria-label="Next day" onClick={() => onChange(shiftDate(date, 1))}>&gt;</button>
      <button className="secondary" onClick={() => onChange(practiceToday())}>Today</button>
    </div>
  );
}

function PasteSchedule({ date, provider, onPaste, onCancel }: {
  date: string; provider: string; onPaste: (text: string) => void; onCancel?: () => void;
}) {
  const [text, setText] = useState("");
  return (
    <div className="card">
      <h2>Load the schedule for {longDate(date)}</h2>
      <p className="small">
        Copy the day's rows from the Outpatient Board, including the header row, and paste them here.
        {provider ? <> Only rows for <strong>{provider}</strong> are kept.</> : <> Set the provider in Setup first, or every row is kept.</>}
      </p>
      <textarea rows={10} value={text} onChange={(e) => setText(e.target.value)} placeholder="Paste the rows here" aria-label="Pasted schedule" />
      <div className="row">
        <button disabled={!text.trim()} onClick={() => onPaste(text)}>Load schedule</button>
        {onCancel && <button className="secondary" onClick={onCancel}>Cancel</button>}
      </div>
    </div>
  );
}

function Board({ entries, rows, files, ready, onRecorded, onState, onError, onOpen, onRePaste }: {
  entries: ScheduleItem[];
  rows: Record<string, RowState>;
  files: Record<string, VisitFile[]>;
  ready: boolean;
  onRecorded: (item: ScheduleItem, transcript: string) => void;
  onState: (id: string, s: RowState) => void;
  onError: (m: string) => void;
  onOpen: (item: ScheduleItem, file: VisitFile) => void;
  onRePaste: () => void;
}) {
  return (
    <>
      <div className="row" style={{ marginBottom: 8 }}>
        <span className="small">{entries.length} appointments</span>
        <span className="grow" />
        <button className="secondary" onClick={onRePaste}>Paste a different schedule</button>
      </div>
      <table className="board">
        <thead>
          <tr><th>Time</th><th>Patient</th><th>Program</th><th>Type</th><th>Documents</th><th /></tr>
        </thead>
        <tbody>
          {entries.map((item) => (
            <Row key={item.id} item={item} state={rows[item.id] ?? { phase: "idle" }} files={files[item.id] ?? []}
              ready={ready} onRecorded={onRecorded} onState={onState} onError={onError} onOpen={onOpen} />
          ))}
        </tbody>
      </table>
    </>
  );
}

function Row({ item, state, files, ready, onRecorded, onState, onError, onOpen }: {
  item: ScheduleItem;
  state: RowState;
  files: VisitFile[];
  ready: boolean;
  onRecorded: (item: ScheduleItem, transcript: string) => void;
  onState: (id: string, s: RowState) => void;
  onError: (m: string) => void;
  onOpen: (item: ScheduleItem, file: VisitFile) => void;
}) {
  const rec = useRef<Recorder | null>(null);
  const [secs, setSecs] = useState(0);
  const [busy, setBusy] = useState(false);
  const docs = documentsFor(item.type);
  const allowed = canRecord(item);
  const since = state.phase === "recording" ? state.since : 0;

  useEffect(() => {
    if (!since) return;
    const t = setInterval(() => setSecs(Math.round((Date.now() - since) / 1000)), 500);
    return () => clearInterval(t);
  }, [since]);

  async function start() {
    setBusy(true);
    try {
      rec.current = await startRecording();
      setSecs(0);
      onState(item.id, { phase: "recording", since: Date.now() });
    } catch (e) {
      onError(`Microphone unavailable: ${e instanceof Error ? e.message : e}`);
    } finally {
      setBusy(false);
    }
  }

  async function stop(audio?: { bytes: Uint8Array; ext: string }) {
    setBusy(true);
    try {
      const got = audio ?? (await rec.current!.stop());
      rec.current = null;
      onState(item.id, { phase: "working", detail: "transcribing on this Mac" });
      const engine = await getEngine();
      const transcript = await engine.transcribe(got.bytes, got.ext);
      onRecorded(item, transcript);
    } catch (e) {
      onState(item.id, { phase: "failed", message: e instanceof Error ? e.message : String(e) });
    } finally {
      setBusy(false);
    }
  }

  const mmss = `${String(Math.floor(secs / 60)).padStart(2, "0")}:${String(secs % 60).padStart(2, "0")}`;
  const shortName = (n: string) =>
    n.endsWith(".txt") ? "Transcript" : n.replace(/^.*\d{4}-\d{2}-\d{2} /, "").replace(/ DRAFT|\.docx$/g, "");

  return (
    <tr className={allowed ? "" : "dim"}>
      <td>{item.time}</td>
      <td>
        {item.patient ? (
          <span title="Shown as initials; the full name is used for the folder and file names.">
            {patientInitials(item.patient.lastName, item.patient.firstName)}
          </span>
        ) : (
          item.clientInfo
        )}
        {item.clientInfo && item.patient && <div className="small">{item.clientInfo}</div>}
      </td>
      <td>{item.program}</td>
      <td>{item.type}</td>
      <td>
        {files.length === 0 && <span className="small">{docs.map((d) => d.label).join(", ") || "none"}</span>}
        <div className="files">
          {files.map((f) => (
            <button key={f.name} className={`file ${f.draft ? "draft" : "final"}`} title={f.name} onClick={() => onOpen(item, f)}>
              {shortName(f.name)}
              {f.draft && <span className="tag">draft</span>}
            </button>
          ))}
        </div>
        {state.phase === "working" && <div className="small">{state.detail}</div>}
        {state.phase === "queued" && <div className="small">Waiting for the previous visit to finish.</div>}
        {state.phase === "failed" && <div className="small err">{state.message}</div>}
      </td>
      <td style={{ textAlign: "right", whiteSpace: "nowrap" }}>
        {!allowed ? (
          <span className="small">
            {item.status.canceled ? "Canceled" : item.status.absent ? "Absent" : item.status.missed ? "Missed" : "No documents"}
          </span>
        ) : state.phase === "recording" ? (
          <>
            <span className="rec"><span className="dot" />{mmss}</span>
            <button onClick={() => stop()} disabled={busy}>Stop</button>
          </>
        ) : state.phase === "working" || state.phase === "queued" ? (
          <span className="small">Generating…</span>
        ) : (
          <>
            <button className="record" disabled={!ready || busy} onClick={start}>
              {state.phase === "done" ? "Record again" : "Record"}
            </button>
            <label className="file-input small" title="Use an audio file instead of the microphone">
              file
              <input type="file" accept="audio/*" onChange={async (e) => {
                const f = e.target.files?.[0];
                if (f) await stop(await recordingFromFile(f));
                e.target.value = "";
              }} />
            </label>
          </>
        )}
      </td>
    </tr>
  );
}

function Preview({ preview, onClose, onReveal, onOpenInWord, onMarkReviewed }: {
  preview: { file: VisitFile; text: string };
  onClose: () => void;
  onReveal: () => void;
  onOpenInWord: () => void;
  onMarkReviewed: () => void;
}) {
  return (
    <div className="modal-back" onClick={onClose}>
      <div className="modal" onClick={(e) => e.stopPropagation()}>
        <div className="row">
          <h2 style={{ margin: 0 }}>{preview.file.name}</h2>
          <span className="grow" />
          <button className="secondary" onClick={onClose}>Close</button>
        </div>
        <p className="small">Read-only preview. Edit and sign in Word.</p>
        <pre className="doc">{preview.text}</pre>
        <div className="row">
          <button onClick={onOpenInWord}>Open in Word</button>
          <button className="secondary" onClick={onReveal}>Show in Finder</button>
          <span className="grow" />
          {preview.file.draft && <button className="secondary" onClick={onMarkReviewed}>Mark reviewed</button>}
        </div>
      </div>
    </div>
  );
}

function Setup({ engine, status, settings, onSaved }: {
  engine: Engine; status: EngineStatus | null; settings: Settings; onSaved: (s: Settings) => void;
}) {
  const [draft, setDraft] = useState<Settings>(settings);
  const [saving, setSaving] = useState(false);
  const field = (k: keyof Settings, label: string, hint?: string) => (
    <label className="field">
      <span>{label}</span>
      <input value={draft[k]} onChange={(e) => setDraft({ ...draft, [k]: e.target.value })} />
      {hint && <span className="small">{hint}</span>}
    </label>
  );
  const models = status?.models ?? [];

  return (
    <div className="card" style={{ maxWidth: 760 }}>
      <h2 style={{ marginTop: 0 }}>Setup</h2>
      {field("master_folder", "Notes folder", "Documents are saved as <this folder>/<Last, First>/<date>/. Keep it on a FileVault disk.")}
      {field("provider_name", "Provider", "Only this provider's rows are kept when a schedule is pasted.")}
      <label className="field">
        <span>Note-writing model</span>
        {models.length ? (
          <select value={draft.model} onChange={(e) => setDraft({ ...draft, model: e.target.value })}>
            <option value="">— choose a model —</option>
            {models.map((m) => <option key={m}>{m}</option>)}
          </select>
        ) : (
          <input value={draft.model} onChange={(e) => setDraft({ ...draft, model: e.target.value })} />
        )}
        <span className="small">Qwen2.5 14B scored best on the practice's test visits.</span>
      </label>
      {field("whisper_model", "Transcription model file", "The Whisper .bin that turns the recording into text.")}
      {field("templates_dir", "Templates folder", "Holds the master template and the forms.")}
      {field("ollama_url", "Model server", "Local only.")}

      <h3>Engines</h3>
      <ul className="small">
        <li>Audio conversion (ffmpeg): {status?.ffmpeg ? "found" : "missing"}</li>
        <li>Transcription (whisper.cpp): {status?.whisper_cli ? "found" : "missing"}</li>
        <li>Transcription model file: {status?.whisper_model ? "found" : "missing"}</li>
        <li>Models available: {models.length ? models.join(", ") : "none found"}</li>
        {engine.kind === "fake" && <li><strong>Running in a browser with fake engines.</strong> Nothing is recorded or saved to disk.</li>}
      </ul>

      <button disabled={saving} onClick={async () => {
        setSaving(true);
        try { onSaved(await engine.setSettings(draft)); } finally { setSaving(false); }
      }}>Save setup</button>
    </div>
  );
}
