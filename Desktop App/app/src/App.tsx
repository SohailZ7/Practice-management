import { useCallback, useEffect, useState } from "react";
import { Feedback } from "./Feedback";
import { fetchAuthConfig, fetchVisits, SignedOutError, syncSchedule, type Session, type Visit } from "./lib/api";
import { getEngine, type Engine, type EngineStatus, type QueueItem } from "./lib/engine";
import { ENVIRONMENTS, isEnvironment, labelFor, urlFor, type EnvironmentId } from "./lib/environments";
import { retryAll, uploadQueued } from "./lib/queue";

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
  | { phase: "saved"; reason: string }
  | { phase: "failed"; message: string };

const SAVED_MESSAGE = "Saved on this Mac, will retry";

export function App() {
  const [engine, setEngine] = useState<Engine | null>(null);
  const [status, setStatus] = useState<EngineStatus | null>(null);
  const [token, setToken] = useState<string | null>(null);
  const [tab, setTab] = useState<"visits" | "feedback" | "setup">("visits");
  const [date, setDate] = useState(practiceToday);
  const [visits, setVisits] = useState<Visit[] | null>(null);
  const [rows, setRows] = useState<Record<string, RowState>>({});
  const [message, setMessage] = useState("");
  const [pasting, setPasting] = useState(false);
  const [provider, setProvider] = useState("");
  const [telehealth, setTelehealth] = useState(true);
  const [queue, setQueue] = useState<QueueItem[]>([]);
  const [retrying, setRetrying] = useState(false);

  const env: EnvironmentId = status && isEnvironment(status.settings.environment) ? status.settings.environment : "production";
  const signedIn = !!status?.signed_in[env];
  const recording = Object.values(rows).some((r) => r.phase === "recording");

  const refreshStatus = useCallback(async (e?: Engine) => {
    const en = e ?? engine;
    if (!en) return;
    setStatus(await en.status());
  }, [engine]);

  useEffect(() => {
    getEngine().then(async (e) => {
      setEngine(e);
      setStatus(await e.status().catch(() => null));
    });
  }, []);

  // The access token lives in the Keychain; fetch it for the selected environment.
  useEffect(() => {
    setToken(null);
    if (!engine || !signedIn) return;
    let alive = true;
    engine.accessToken(env).then((t) => alive && setToken(t)).catch(() => alive && setToken(null));
    return () => { alive = false; };
  }, [engine, env, signedIn]);

  const session: Session | null =
    engine && token
      ? {
          baseUrl: urlFor(env),
          accessToken: token,
          refresh: async (stale) => {
            const next = await engine.refreshAccessToken(env, stale);
            if (next) setToken(next);
            return next;
          },
        }
      : null;

  const load = useCallback(async () => {
    if (!session) { setVisits(null); return; }
    try {
      const r = await fetchVisits(session, date);
      setVisits(r.visits);
      setMessage("");
    } catch (e) {
      setVisits(null);
      if (e instanceof SignedOutError) await refreshStatus(); // the sign-in screen takes over
      else setMessage(e instanceof Error ? e.message : String(e));
    }
  }, [env, token, date]);

  // Switching environment or date starts from a clean schedule.
  useEffect(() => {
    setRows({});
    setVisits(null);
    void load();
  }, [load]);

  const loadQueue = useCallback(async () => {
    if (!engine) return;
    setQueue(await engine.queueList().catch(() => []));
  }, [engine]);

  const retryQueue = useCallback(async () => {
    if (!engine) return;
    setRetrying(true);
    try {
      await retryAll(engine);
      await loadQueue();
      await refreshStatus();
    } finally {
      setRetrying(false);
    }
  }, [engine, loadQueue, refreshStatus]);

  // Retry at launch, and again whenever a sign-in becomes available (a different environment or a fresh sign-in).
  const signedInKey = status ? JSON.stringify(status.signed_in) : "";
  useEffect(() => {
    if (!engine || !status) return;
    void loadQueue().then(() => retryQueue());
  }, [engine, signedInKey]);

  const setRow = (id: string, s: RowState) => setRows((r) => ({ ...r, [id]: s }));
  const ready = !!engine && (engine.kind === "fake" || !!status?.whisper_model);

  const missing: string[] = [];
  if (engine?.kind === "native" && !status?.whisper_model) missing.push("the transcription model");
  const queuedIds = new Set(queue.map((q) => q.visit_id));

  const changeEnvironment = async (next: EnvironmentId) => {
    if (!engine || next === env) return;
    try {
      await engine.setEnvironment(next);
      setPasting(false);
      setMessage("");
      await refreshStatus();
    } catch (e) {
      setMessage(e instanceof Error ? e.message : String(e));
    }
  };

  return (
    <>
      {env !== "production" && (
        <div className={`envbar ${env}`} role="status">
          {labelFor(env).toUpperCase()} {env === "localhost" ? "(this Mac)" : "(test server)"}: not the production practice app
        </div>
      )}
      <header className="top">
        <h1>Practice Recorder</h1>
        {signedIn && (
          <nav className="tabs">
            <button className={tab === "visits" ? "on" : ""} onClick={() => setTab("visits")}>Visits</button>
            <button className={tab === "feedback" ? "on" : ""} onClick={() => setTab("feedback")}>Feedback</button>
            <button className={tab === "setup" ? "on" : ""} onClick={() => setTab("setup")}>Setup</button>
          </nav>
        )}
      </header>
      <main>
        {message && <div className="banner" role="status">{message} <button className="link" onClick={() => setMessage("")}>Dismiss</button></div>}

        {queue.length > 0 && (
          <div className="banner" role="status">
            {queue.length} transcript{queue.length === 1 ? " is" : "s are"} saved on this Mac and will be sent when the
            practice app is reachable.{" "}
            <button className="link" disabled={retrying} onClick={() => void retryQueue()}>{retrying ? "Retrying…" : "Retry all"}</button>
          </div>
        )}

        {status && engine && !signedIn && (
          <Setup engine={engine} status={status} env={env} signedIn={false} locked={recording}
            onEnvironment={changeEnvironment} onChanged={() => refreshStatus()} />
        )}

        {status && engine && signedIn && tab === "setup" && (
          <Setup engine={engine} status={status} env={env} signedIn locked={recording}
            onEnvironment={changeEnvironment} onChanged={() => refreshStatus()} />
        )}

        {signedIn && tab === "feedback" && session && engine && (
          <Feedback engine={engine} session={session} visitRecording={recording} onSignedOut={() => refreshStatus()} />
        )}

        {signedIn && tab === "visits" && (
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
                      queued={queuedIds.has(v.id)} env={env}
                      onState={setRow} engine={engine!} session={session} telehealth={telehealth}
                      onSent={() => { void load(); void loadQueue(); }} />
                  ))}
                </tbody>
              </table>
            )}
            <p className="small">
              The recording stays on this Mac and is never saved. It is turned into text here, and only the text is sent
              to the practice app, where the notes are written. Until the practice app confirms it, the text is kept
              encrypted on this Mac. With <strong>Telehealth</strong> ticked, the call's audio is recorded as well as
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

function Row({ visit, state, ready, queued, env, onState, engine, session, onSent, telehealth }: {
  visit: Visit; state: RowState; ready: boolean; queued: boolean; env: EnvironmentId;
  onState: (id: string, s: RowState) => void;
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

  async function stop() {
    setBusy(true);
    try {
      onState(visit.id, { phase: "working", detail: "transcribing on this Mac" });
      // The transcript is saved (encrypted) on this Mac before anything is sent.
      const summary = await engine.stopRecording(visit.id, env);
      // A telehealth call that only heard one person would produce a note missing half the visit.
      if (summary.one_sided && telehealth) {
        const go = window.confirm(
          "Only one side of this call was recorded, so the note would be missing what the other person said.\n\n" +
            "Send it anyway?",
        );
        if (!go) {
          await engine.queueDiscard(visit.id);
          return onState(visit.id, { phase: "idle" });
        }
      }
      onState(visit.id, { phase: "working", detail: "sending to the practice app" });
      const item = (await engine.queueList()).find((q) => q.visit_id === visit.id);
      const result = item ? await uploadQueued(engine, item, session) : { ok: false, reason: "missing" };
      onState(visit.id, result.ok ? { phase: "sent" } : { phase: "saved", reason: SAVED_MESSAGE });
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
        {state.phase === "recording" && state.warning && <span className="err">{state.warning}</span>}
        {state.phase === "working" && state.detail}
        {state.phase === "failed" && <span className="err">{state.message}</span>}
        {state.phase === "saved" && <span className="err">{state.reason}</span>}
        {state.phase === "sent" && "Transcript sent"}
        {state.phase === "idle" && queued && <span className="err">{SAVED_MESSAGE}</span>}
        {state.phase === "idle" && !queued && (visit.hasTranscript ? `Transcript on file${visit.documentCount ? `, ${visit.documentCount} documents` : ""}` : "")}
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
          <button className="record" disabled={!ready || busy} onClick={start}>
            {visit.hasTranscript || state.phase === "sent" ? "Record again" : "Record"}
          </button>
        )}
      </td>
    </tr>
  );
}

function Setup({ engine, status, env, signedIn, locked, onEnvironment, onChanged }: {
  engine: Engine; status: EngineStatus; env: EnvironmentId; signedIn: boolean; locked: boolean;
  onEnvironment: (e: EnvironmentId) => void; onChanged: () => Promise<void> | void;
}) {
  const [signingIn, setSigningIn] = useState(false);
  const [error, setError] = useState("");
  // null while unknown, so the button is never offered before the server has been asked.
  const [googleAvailable, setGoogleAvailable] = useState<boolean | null>(null);
  const url = urlFor(env);

  useEffect(() => {
    setGoogleAvailable(null);
    setError("");
    let alive = true;
    fetchAuthConfig(url)
      .then((c) => alive && setGoogleAvailable(c.googleSignIn))
      .catch(() => alive && setGoogleAvailable(false));
    return () => { alive = false; };
  }, [url]);

  return (
    <div className="card" style={{ maxWidth: 760 }}>
      <h2 style={{ marginTop: 0 }}>{signedIn ? "Setup" : "Sign in"}</h2>

      <label className="field">
        <span>Environment</span>
        <select value={env} disabled={locked} onChange={(e) => onEnvironment(e.target.value as EnvironmentId)}>
          {ENVIRONMENTS.map((e) => <option key={e.id} value={e.id}>{e.label}</option>)}
        </select>
        <span className="small">
          {locked ? "Locked while a recording is running. " : ""}Each environment has its own sign-in.
        </span>
      </label>

      {signedIn ? (
        <p className="small"><strong>Signed in to {labelFor(env)}.</strong></p>
      ) : (
        <p className="small">Sign in with your Google account to use the recorder. Nothing works until you do.</p>
      )}
      {error && <p className="small err">{error}</p>}

      {googleAvailable === false && (
        <p className="small">
          Google sign-in is not set up on this server yet. An administrator needs to create a Google OAuth client of type{" "}
          <strong>Desktop app</strong> and set GOOGLE_DESKTOP_CLIENT_ID and GOOGLE_DESKTOP_CLIENT_SECRET on the practice app.
        </p>
      )}

      <div className="row" style={{ marginBottom: ".8rem" }}>
        {googleAvailable !== false && (
          <button
            disabled={signingIn || googleAvailable !== true}
            onClick={async () => {
              setSigningIn(true);
              setError("");
              try {
                await engine.signInWithGoogle(env);
                await onChanged();
              } catch (e) {
                setError(e instanceof Error ? e.message : String(e));
              } finally {
                setSigningIn(false);
              }
            }}
          >
            {signingIn ? "Waiting for the browser…" : signedIn ? "Sign in again with Google" : "Sign in with Google"}
          </button>
        )}
        {signedIn && (
          <button className="secondary" disabled={locked} onClick={async () => { await engine.signOut(env); await onChanged(); }}>
            Sign out
          </button>
        )}
      </div>

      {signedIn && (
        <>
          <h3>Transcription</h3>
          <ul className="small">
            <li>Transcription model: {status.whisper_model ? "found" : "missing"}</li>
            {engine.kind === "fake" && <li><strong>Running in a browser with fake engines.</strong> Nothing is recorded.</li>}
          </ul>
          <p className="small">Transcription runs inside this app, on this Mac. The recording is never saved.</p>
        </>
      )}
    </div>
  );
}
