import { useCallback, useEffect, useRef, useState } from "react";
import { fetchVisits, pushTranscript, type Session, type Visit } from "./lib/api";
import { getEngine, type Engine, type EngineStatus, type Settings } from "./lib/engine";
import { startRecording, recordingFromFile, type Recorder } from "./lib/recorder";

// "Today" is the practice's day, not the device's, so everyone means the same thing by it.
const practiceToday = () => new Intl.DateTimeFormat("en-CA", { timeZone: "America/Los_Angeles" }).format(new Date());
const shift = (iso: string, days: number) => {
  const d = new Date(`${iso}T00:00:00Z`);
  d.setUTCDate(d.getUTCDate() + days);
  return d.toISOString().slice(0, 10);
};
const longDate = (iso: string) =>
  new Date(`${iso}T00:00:00Z`).toLocaleDateString("en-US", { weekday: "long", month: "long", day: "numeric", year: "numeric", timeZone: "UTC" });

type RowState =
  | { phase: "idle" }
  | { phase: "recording"; since: number }
  | { phase: "working"; detail: string }
  | { phase: "sent" }
  | { phase: "failed"; message: string };

export function App() {
  const [engine, setEngine] = useState<Engine | null>(null);
  const [status, setStatus] = useState<EngineStatus | null>(null);
  const [settings, setSettings] = useState<Settings | null>(null);
  const [tab, setTab] = useState<"visits" | "setup">("visits");
  const [date, setDate] = useState(practiceToday);
  const [visits, setVisits] = useState<Visit[] | null>(null);
  const [rows, setRows] = useState<Record<string, RowState>>({});
  const [message, setMessage] = useState("");

  useEffect(() => {
    getEngine().then(async (e) => {
      setEngine(e);
      const s = await e.status().catch(() => null);
      setStatus(s);
      setSettings(s?.settings ?? (await e.getSettings()));
    });
  }, []);

  const session: Session | null =
    settings?.practice_url && settings.access_token
      ? { baseUrl: settings.practice_url, accessToken: settings.access_token }
      : null;

  const load = useCallback(async () => {
    if (!session) return;
    try {
      const r = await fetchVisits(session, date);
      setVisits(r.visits);
      setMessage("");
    } catch (e) {
      setVisits(null);
      setMessage(e instanceof Error ? e.message : String(e));
    }
  }, [session?.baseUrl, session?.accessToken, date]);

  useEffect(() => {
    setRows({});
    void load();
  }, [load]);

  const setRow = (id: string, s: RowState) => setRows((r) => ({ ...r, [id]: s }));
  const ready = !!engine && (engine.kind === "fake" || (!!status?.whisper_cli && !!status?.whisper_model && !!status?.ffmpeg));

  const missing: string[] = [];
  if (engine?.kind === "native") {
    if (!status?.ffmpeg) missing.push("audio conversion");
    if (!status?.whisper_cli) missing.push("transcription");
    if (!status?.whisper_model) missing.push("the transcription model");
  }
  if (!session) missing.push("the practice address and sign-in");

  return (
    <>
      <header className="top">
        <h1>Practice Recorder</h1>
        <nav className="tabs">
          <button className={tab === "visits" ? "on" : ""} onClick={() => setTab("visits")}>Visits</button>
          <button className={tab === "setup" ? "on" : ""} onClick={() => setTab("setup")}>Setup</button>
        </nav>
      </header>
      <main>
        {message && <div className="banner" role="status">{message} <button className="link" onClick={() => setMessage("")}>Dismiss</button></div>}

        {tab === "setup" && engine && settings && (
          <Setup engine={engine} status={status} settings={settings}
            onSaved={(s) => { setSettings(s); setMessage("Setup saved."); void load(); }} />
        )}

        {tab === "visits" && (
          <>
            <div className="datebar">
              <button className="secondary" aria-label="Previous day" onClick={() => setDate(shift(date, -1))}>&lt;</button>
              <strong>{longDate(date)}</strong>
              <input type="date" value={date} aria-label="Pick a date" onChange={(e) => e.target.value && setDate(e.target.value)} />
              <button className="secondary" aria-label="Next day" onClick={() => setDate(shift(date, 1))}>&gt;</button>
              <button className="secondary" onClick={() => setDate(practiceToday())}>Today</button>
              <span className="grow" />
              <button className="secondary" onClick={() => void load()}>Refresh</button>
            </div>

            {missing.length > 0 && (
              <div className="banner">
                Recording is off because {missing.join(", ")} {missing.length === 1 ? "is" : "are"} not set up. Open{" "}
                <button className="link" onClick={() => setTab("setup")}>Setup</button>.
              </div>
            )}

            {!session ? null : visits === null ? (
              <p className="small">Could not reach the practice app.</p>
            ) : visits.length === 0 ? (
              <p className="small">No visits for this day. Load the day's schedule in the practice app first.</p>
            ) : (
              <table className="board">
                <thead><tr><th>Patient</th><th>Program</th><th>Type</th><th>Status</th><th /></tr></thead>
                <tbody>
                  {visits.map((v) => (
                    <Row key={v.id} visit={v} state={rows[v.id] ?? { phase: "idle" }} ready={ready && !!session}
                      onState={setRow} engine={engine!} session={session} onSent={() => void load()} />
                  ))}
                </tbody>
              </table>
            )}
            <p className="small">
              The recording stays on this Mac. It is turned into text here, and only the text is sent to the practice app,
              where the notes are written.
            </p>
          </>
        )}
      </main>
    </>
  );
}

function Row({ visit, state, ready, onState, engine, session, onSent }: {
  visit: Visit; state: RowState; ready: boolean; onState: (id: string, s: RowState) => void;
  engine: Engine; session: Session; onSent: () => void;
}) {
  const rec = useRef<Recorder | null>(null);
  const [secs, setSecs] = useState(0);
  const [busy, setBusy] = useState(false);
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
      onState(visit.id, { phase: "recording", since: Date.now() });
    } catch (e) {
      onState(visit.id, { phase: "failed", message: `Microphone unavailable: ${e instanceof Error ? e.message : e}` });
    } finally {
      setBusy(false);
    }
  }

  async function stop(audio?: { bytes: Uint8Array; ext: string }) {
    setBusy(true);
    try {
      const got = audio ?? (await rec.current!.stop());
      rec.current = null;
      onState(visit.id, { phase: "working", detail: "transcribing on this Mac" });
      const transcript = await engine.transcribe(got.bytes, got.ext);
      if (!transcript.trim()) throw new Error("The recording produced no text.");
      onState(visit.id, { phase: "working", detail: "sending to the practice app" });
      await pushTranscript(session, visit.id, transcript);
      onState(visit.id, { phase: "sent" });
      onSent();
    } catch (e) {
      onState(visit.id, { phase: "failed", message: e instanceof Error ? e.message : String(e) });
    } finally {
      setBusy(false);
    }
  }

  const mmss = `${String(Math.floor(secs / 60)).padStart(2, "0")}:${String(secs % 60).padStart(2, "0")}`;

  return (
    <tr>
      <td title="Shown as initials">{visit.initials}</td>
      <td>{visit.program}</td>
      <td>{visit.appointmentType}</td>
      <td className="small">
        {state.phase === "working" && state.detail}
        {state.phase === "failed" && <span className="err">{state.message}</span>}
        {state.phase === "sent" && "Transcript sent"}
        {state.phase === "idle" && (visit.hasTranscript ? `Transcript on file${visit.documentCount ? `, ${visit.documentCount} documents` : ""}` : "")}
      </td>
      <td style={{ textAlign: "right", whiteSpace: "nowrap" }}>
        {state.phase === "recording" ? (
          <>
            <span className="rec"><span className="dot" />{mmss}</span>
            <button onClick={() => stop()} disabled={busy}>Stop</button>
          </>
        ) : state.phase === "working" ? (
          <span className="small">Working…</span>
        ) : (
          <>
            <button className="record" disabled={!ready || busy} onClick={start}>
              {visit.hasTranscript || state.phase === "sent" ? "Record again" : "Record"}
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

function Setup({ engine, status, settings, onSaved }: {
  engine: Engine; status: EngineStatus | null; settings: Settings; onSaved: (s: Settings) => void;
}) {
  const [draft, setDraft] = useState<Settings>(settings);
  const [saving, setSaving] = useState(false);
  const field = (k: keyof Settings, label: string, hint: string, type = "text") => (
    <label className="field">
      <span>{label}</span>
      <input type={type} value={draft[k]} onChange={(e) => setDraft({ ...draft, [k]: e.target.value })} />
      <span className="small">{hint}</span>
    </label>
  );

  return (
    <div className="card" style={{ maxWidth: 760 }}>
      <h2 style={{ marginTop: 0 }}>Setup</h2>
      {field("practice_url", "Practice app address", "Where the practice app runs, for example https://notes.example.org")}
      {field("access_token", "Sign-in token", "Issued by the practice app. Treat it like a password.", "password")}
      {field("whisper_model", "Transcription model file", "The Whisper .bin that turns the recording into text.")}

      <h3>Engines</h3>
      <ul className="small">
        <li>Audio conversion: {status?.ffmpeg ? "found" : "missing"}</li>
        <li>Transcription: {status?.whisper_cli ? "found" : "missing"}</li>
        <li>Transcription model file: {status?.whisper_model ? "found" : "missing"}</li>
        {engine.kind === "fake" && <li><strong>Running in a browser with fake engines.</strong> Nothing is recorded.</li>}
      </ul>

      <button disabled={saving} onClick={async () => {
        setSaving(true);
        try { onSaved(await engine.setSettings(draft)); } finally { setSaving(false); }
      }}>Save setup</button>
    </div>
  );
}
