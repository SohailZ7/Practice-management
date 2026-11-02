import { useCallback, useEffect, useRef, useState } from "react";
import { fetchVisits, pushTranscript, syncSchedule, type Session, type Visit } from "./lib/api";
import { getEngine, type Engine, type EngineStatus, type Settings } from "./lib/engine";
import { recordingFromFile } from "./lib/recorder";

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
  | { phase: "recording"; since: number; warning?: string }
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
  const [pasting, setPasting] = useState(false);
  const [provider, setProvider] = useState("");
  const [telehealth, setTelehealth] = useState(true);

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
              {session && <button className="secondary" onClick={() => setPasting((v) => !v)}>{pasting ? "Cancel" : "Paste schedule"}</button>}
              <label className="small" title="A telehealth visit also records what comes out of the speakers">
                <input type="checkbox" checked={telehealth} onChange={(e) => setTelehealth(e.target.checked)} /> Telehealth
              </label>
            </div>

            {missing.length > 0 && (
              <div className="banner">
                Recording is off because {missing.join(", ")} {missing.length === 1 ? "is" : "are"} not set up. Open{" "}
                <button className="link" onClick={() => setTab("setup")}>Setup</button>.
              </div>
            )}

            {pasting && session && (
              <PasteSchedule
                date={date}
                provider={provider}
                onProvider={setProvider}
                onDone={(m) => { setPasting(false); setMessage(m); void load(); }}
                sync={(text) => syncSchedule(session, date, text, provider)}
              />
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
                      onState={setRow} engine={engine!} session={session} onSent={() => void load()} telehealth={telehealth} />
                  ))}
                </tbody>
              </table>
            )}
            <p className="small">
              The recording stays on this Mac. It is turned into text here, and only the text is sent to the practice app,
              where the notes are written. With <strong>Telehealth</strong> ticked, the call's audio is recorded as well as
              your microphone, so the patient's side of the visit is captured; macOS asks for Screen Recording permission
              the first time, which is what it calls listening to another app.
            </p>
          </>
        )}
      </main>
    </>
  );
}

function PasteSchedule({ date, provider, onProvider, onDone, sync }: {
  date: string;
  provider: string;
  onProvider: (p: string) => void;
  onDone: (message: string) => void;
  sync: (text: string) => Promise<import("./lib/api").LoadResult>;
}) {
  const [text, setText] = useState("");
  const [busy, setBusy] = useState(false);
  return (
    <div className="card">
      <h2 style={{ marginTop: 0 }}>Paste the board for {longDate(date)}</h2>
      <p className="small">
        Copy the day's rows from the Outpatient Board, including the header row. The practice app reads them and
        creates the visits. Only rows for the provider below are kept; leave it empty to keep every row.
      </p>
      <label className="field">
        <span>Provider</span>
        <input value={provider} onChange={(e) => onProvider(e.target.value)} placeholder="Dr. Khalid Ahmed" />
      </label>
      <textarea rows={8} value={text} onChange={(e) => setText(e.target.value)} placeholder="Paste the rows here" aria-label="Pasted schedule" />
      <div className="row">
        <button disabled={!text.trim() || busy} onClick={async () => {
          setBusy(true);
          try {
            const r = await sync(text);
            onDone(
              `Added ${r.created} visit${r.created === 1 ? "" : "s"} from ${r.kept} row${r.kept === 1 ? "" : "s"}.` +
                (r.skippedExisting ? ` ${r.skippedExisting} were already there.` : "") +
                (r.otherProviders.length ? ` Skipped ${r.skippedOtherProvider} for ${r.otherProviders.join(", ")}.` : ""),
            );
          } catch (e) {
            onDone(e instanceof Error ? e.message : String(e));
          } finally {
            setBusy(false);
          }
        }}>{busy ? "Sending…" : "Send to the practice app"}</button>
      </div>
    </div>
  );
}

function Row({ visit, state, ready, onState, engine, session, onSent, telehealth }: {
  visit: Visit; state: RowState; ready: boolean; onState: (id: string, s: RowState) => void;
  engine: Engine; session: Session; onSent: () => void; telehealth: boolean;
}) {
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
      const { warning } = await engine.startRecording(telehealth);
      setSecs(0);
      onState(visit.id, { phase: "recording", since: Date.now(), warning: warning ?? undefined });
    } catch (e) {
      onState(visit.id, { phase: "failed", message: e instanceof Error ? e.message : String(e) });
    } finally {
      setBusy(false);
    }
  }

  async function send(transcript: string) {
    onState(visit.id, { phase: "working", detail: "sending to the practice app" });
    await pushTranscript(session, visit.id, transcript);
    onState(visit.id, { phase: "sent" });
    onSent();
  }

  async function stop() {
    setBusy(true);
    try {
      onState(visit.id, { phase: "working", detail: "transcribing on this Mac" });
      const [transcript, summary] = await engine.stopRecording();
      if (!transcript.trim()) throw new Error("The recording produced no text.");
      // A telehealth call that only heard one person would produce a note missing half the visit.
      if (summary.one_sided && telehealth) {
        const go = window.confirm(
          "Only one side of this call was recorded, so the note would be missing what the other person said.\n\n" +
            "Send it anyway?",
        );
        if (!go) return onState(visit.id, { phase: "idle" });
      }
      await send(transcript);
    } catch (e) {
      onState(visit.id, { phase: "failed", message: e instanceof Error ? e.message : String(e) });
    } finally {
      setBusy(false);
    }
  }

  async function fromFile(file: File) {
    setBusy(true);
    try {
      onState(visit.id, { phase: "working", detail: "transcribing on this Mac" });
      const audio = await recordingFromFile(file);
      const transcript = await engine.transcribe(audio.bytes, audio.ext);
      if (!transcript.trim()) throw new Error("That file produced no text.");
      await send(transcript);
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
        {state.phase === "recording" && state.warning && <span className="err">{state.warning}</span>}
        {state.phase === "working" && state.detail}
        {state.phase === "failed" && <span className="err">{state.message}</span>}
        {state.phase === "sent" && "Transcript sent"}
        {state.phase === "idle" && (visit.hasTranscript ? `Transcript on file${visit.documentCount ? `, ${visit.documentCount} documents` : ""}` : "")}
      </td>
      <td style={{ textAlign: "right", whiteSpace: "nowrap" }}>
        {state.phase === "recording" ? (
          <>
            <span className="rec"><span className="dot" />{mmss}</span>
            <button onClick={stop} disabled={busy}>Stop</button>
            <button className="secondary" disabled={busy} onClick={async () => {
              await engine.cancelRecording();
              onState(visit.id, { phase: "idle" });
            }}>Discard</button>
          </>
        ) : state.phase === "working" ? (
          <span className="small">Working…</span>
        ) : (
          <>
            <button className="record" disabled={!ready || busy} onClick={start}>
              {visit.hasTranscript || state.phase === "sent" ? "Record again" : "Record"}
            </button>
            <label className="file-input small" title="Use an audio file instead of recording">
              file
              <input type="file" accept="audio/*" onChange={async (e) => {
                const f = e.target.files?.[0];
                if (f) await fromFile(f);
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
  const [signingIn, setSigningIn] = useState(false);
  const [error, setError] = useState("");
  const connected = !!settings.access_token;

  return (
    <div className="card" style={{ maxWidth: 760 }}>
      <h2 style={{ marginTop: 0 }}>Setup</h2>

      <h3 style={{ marginTop: 0 }}>1. Connect to the practice app</h3>
      <p className="small">
        The recorder sends transcripts to the practice app, which writes the notes. Enter its address, then sign in.
      </p>
      <label className="field">
        <span>Practice app address</span>
        <input
          value={draft.practice_url}
          placeholder="https://notes.example.org"
          onChange={(e) => setDraft({ ...draft, practice_url: e.target.value })}
        />
      </label>

      {connected ? (
        <p className="small"><strong>Connected.</strong> Sign in again to use a different account.</p>
      ) : (
        <p className="small">Not connected yet.</p>
      )}
      {error && <p className="small err">{error}</p>}

      <div className="row" style={{ marginBottom: ".8rem" }}>
        <button
          disabled={!draft.practice_url.trim() || signingIn}
          onClick={async () => {
            setSigningIn(true);
            setError("");
            try {
              onSaved(await engine.signInWithGoogle(draft.practice_url.trim()));
            } catch (e) {
              setError(e instanceof Error ? e.message : String(e));
            } finally {
              setSigningIn(false);
            }
          }}
        >
          {signingIn ? "Waiting for the browser…" : "Sign in with Google"}
        </button>
      </div>

      <details style={{ marginBottom: "1rem" }}>
        <summary className="small">Or paste a token instead</summary>
        <p className="small">
          In the practice app, open Settings and choose <strong>Connect a recorder</strong>. It shows a token once.
          Paste it here. This works even when Google sign-in has not been set up.
        </p>
        <label className="field">
          <span>Pairing token</span>
          <input
            type="password"
            value={draft.access_token}
            onChange={(e) => setDraft({ ...draft, access_token: e.target.value })}
          />
        </label>
      </details>

      <h3>2. Transcription</h3>
      <label className="field">
        <span>Transcription model file</span>
        <input value={draft.whisper_model} onChange={(e) => setDraft({ ...draft, whisper_model: e.target.value })} />
        <span className="small">The Whisper .bin that turns the recording into text, on this Mac.</span>
      </label>
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
