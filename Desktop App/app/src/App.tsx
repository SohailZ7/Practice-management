import { useCallback, useEffect, useRef, useState, useSyncExternalStore } from "react";
import { addedSeparator } from "./lib/append";
import logo from "./assets/logo.png";
import { TranscriptDialog } from "./TranscriptDialog";
import { Modal } from "./Modal";
import { DocumentIcons, GenerateDialog } from "./DocumentDialogs";
import { Tasks } from "./Tasks";
import { Search } from "./Search";
import { Mfa } from "./Mfa";
import { clearGeneration, generationFor, startGenerate, subscribe } from "./lib/generate";
import { Feedback } from "./Feedback";
import { longDate, practiceToday, shiftDate as shift } from "./lib/dates";
import { isPromoted, markPromoted, promoteBlocker, promoteVisit } from "./lib/promote";
import { canShowFullNames, displayVisits, loadShowFull, saveShowFull } from "./lib/names";
import { clientNameToSend, formChoices, visitFormErrors } from "./lib/visitForm";
import { ComboField, StrictSelect, TimeCell, TimeField } from "./Fields";
import { normalizeTime } from "./lib/times";
import { sendDiagnostics, pushTranscript, fetchVisitOptions, type VisitOptions, createVisit, deleteVisit, deleteVisits, updateVisit, visitErrorMessage, fetchAuthConfig, fetchTranscript, fetchVisits, SignedOutError, syncSchedule, type Session, type Visit } from "./lib/api";
import { getEngine, type Engine, type EngineStatus, type QueueItem } from "./lib/engine";
import { ENVIRONMENTS, isEnvironment, labelFor, urlFor, type EnvironmentId } from "./lib/environments";
import { UpdateBanner } from "./UpdateBanner";
import { SpeakerDialog } from "./SpeakerDialog";
import { patientChoice } from "./lib/transcriptView";
import { installGlobalHandlers, setSender } from "./lib/diagnostics";
import { retryAll, sessionFor, setCopyLabel, uploadQueued } from "./lib/queue";

// "Today" is the practice's day, not the device's, so everyone means the same thing by it.
type RowState =
  | { phase: "idle" }
  | { phase: "recording"; since: number; warning?: string }
  | { phase: "working"; detail: string }
  | { phase: "sent"; note?: string }
  | { phase: "saved"; reason: string }
  | { phase: "failed"; message: string };

const SAVED_MESSAGE = "Saved on this Mac, will retry";

export function App() {
  const [engine, setEngine] = useState<Engine | null>(null);
  const [status, setStatus] = useState<EngineStatus | null>(null);
  const [token, setToken] = useState<string | null>(null);
  const [tab, setTab] = useState<"visits" | "search" | "tasks" | "feedback" | "setup">("visits");
  const [date, setDate] = useState(practiceToday);
  const [visits, setVisits] = useState<Visit[] | null>(null);
  const [showFull, setShowFull] = useState(loadShowFull);
  const [rows, setRows] = useState<Record<string, RowState>>({});
  const [message, setMessage] = useState("");
  useEffect(() => { setMessage(""); }, [tab]); // a notice belongs to the screen that raised it
  const [pasting, setPasting] = useState(false);
  const [provider, setProvider] = useState("");
  const [adding, setAdding] = useState(false);
  const [options, setOptions] = useState<VisitOptions | null>(null);
  const [selected, setSelected] = useState<Set<string>>(new Set());
  const [confirmBulk, setConfirmBulk] = useState(false);
  const [bulkBusy, setBulkBusy] = useState(false);
  // Only keep ticks for rows that are still on screen (the day changed or rows were deleted).
  useEffect(() => {
    setSelected((cur) => {
      const ids = new Set((visits ?? []).map((v) => v.id));
      const next = new Set([...cur].filter((id) => ids.has(id)));
      return next.size === cur.size ? cur : next;
    });
  }, [visits]);
  const [queue, setQueue] = useState<QueueItem[]>([]);
  const [retrying, setRetrying] = useState(false);

  const env: EnvironmentId = status && isEnvironment(status.settings.environment) ? status.settings.environment : "production";
  const signedIn = !!status?.signed_in[env];
  useEffect(() => {
    // Window title carries the environment and build so a stale install or the wrong server is obvious.
    import("@tauri-apps/api/window").then((m) => m.getCurrentWindow().setTitle(`Brain and Behavior Center - ${labelFor(env).toUpperCase()} - v${__APP_VERSION__} (${__APP_COMMIT__})`)).catch(() => {});
  }, [env]);
  const recording = Object.values(rows).some((r) => r.phase === "recording");
  const busy = Object.values(rows).some((r) => r.phase === "recording" || r.phase === "working");

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

  const sessionRef = useRef(session);
  sessionRef.current = session;
  useEffect(() => { installGlobalHandlers(); }, []);
  // Errors are reported to the practice app automatically (at most every 5 minutes); no patient data is in them.
  useEffect(() => {
    if (!signedIn) { setSender(null); return; }
    setSender(() => { const s = sessionRef.current; if (s) void sendDiagnostics(s, false, env).catch(() => {}); });
    return () => setSender(null);
  }, [signedIn, env]);

  useEffect(() => {
    setOptions(null);
    if (!session || !adding) return;
    let alive = true;
    fetchVisitOptions(session).then((o) => alive && setOptions(o)).catch(() => {});
    return () => { alive = false; };
  }, [session?.baseUrl, token, adding]);

  const load = useCallback(async () => {
    if (!session) { setVisits(null); return; }
    try {
      const r = await fetchVisits(session, date);
      setVisits(r.visits);
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
    setMessage("");
  }, [env, date]);
  // A refreshed sign-in token only reloads the list. It must not wipe what the rows show (a recording in progress, a
  // failure message), so the reset above is tied to the environment and the date alone.
  useEffect(() => { void load(); }, [load]);

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
        <img src={logo} alt="" width={26} height={26} style={{ borderRadius: 6 }} />
        <h1>Brain and Behavior Center <span style={{ fontWeight: 400, opacity: 0.75 }}>· Practice Recorder</span></h1>
        {signedIn && (
          <nav className="tabs">
            <button className={tab === "visits" ? "on" : ""} onClick={() => setTab("visits")}>Visits</button>
            <button className={tab === "search" ? "on" : ""} onClick={() => setTab("search")}>Find a visit</button>
            <button className={tab === "tasks" ? "on" : ""} onClick={() => setTab("tasks")}>My Tasks</button>
            <button className={tab === "feedback" ? "on" : ""} onClick={() => setTab("feedback")}>Feedback</button>
            <button className={tab === "setup" ? "on" : ""} onClick={() => setTab("setup")}>Setup</button>
          </nav>
        )}
      </header>
      <main>
        <UpdateBanner session={session} busy={busy} />
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
          <Setup engine={engine} status={status} env={env} signedIn session={session} locked={recording}
            onEnvironment={changeEnvironment} onChanged={() => refreshStatus()} />
        )}

        {signedIn && tab === "search" && session && engine && (
          <Search engine={engine} session={session} onSignedOut={() => refreshStatus()} />
        )}

        {signedIn && tab === "tasks" && session && (
          <Tasks session={session} onSignedOut={() => refreshStatus()} />
        )}

        {signedIn && tab === "feedback" && session && engine && (
          <Feedback engine={engine} env={env} session={session} visitRecording={recording} onSignedOut={() => refreshStatus()} />
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
              {session && <button className="secondary" onClick={() => { setAdding((v) => !v); setPasting(false); }}>{adding ? "Cancel" : "Add one visit"}</button>}
              {session && <button className="secondary" onClick={() => { setPasting((v) => !v); setAdding(false); }}>{pasting ? "Cancel" : "Paste schedule"}</button>}
              {canShowFullNames(visits) && (
                <label className="small" title="Only people the practice has allowed see this option.">
                  <input type="checkbox" checked={showFull} onChange={(e) => { setShowFull(e.target.checked); saveShowFull(e.target.checked); }} /> Show full names
                </label>
              )}
            </div>

            {missing.length > 0 && (
              <div className="banner">
                Recording is off because {missing.join(", ")} {missing.length === 1 ? "is" : "are"} not set up. Open{" "}
                <button className="link" onClick={() => setTab("setup")}>Setup</button>.
              </div>
            )}

            {adding && session && (
              <AddVisit
                date={date}
                options={mergeOptions(options, visits ?? [], provider)}
                provider={provider}
                onProvider={setProvider}
                onDone={(m) => { setAdding(false); setMessage(m); void load(); }}
                create={async (v) => {
                  const made = await createVisit(session, date, v);
                  // Read the day back: the server said "created", so the visit must be in that day's list.
                  const back = await fetchVisits(session, date);
                  setVisits(back.visits);
                  if (!back.visits.some((x) => x.id === made.id)) {
                    throw new Error("The practice app accepted the visit but it is not in the list for " + longDate(date) + ". Nothing was lost; tell support.");
                  }
                  return made;
                }}
              />
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
              <p className="small">No visits for this day. Use Add one visit or Paste schedule.</p>
            ) : (
              <>
              {selected.size > 0 && (
                <div className="row" style={{ marginBottom: ".5rem" }}>
                  {confirmBulk ? (
                    <>
                      <span className="small">
                        Delete {selected.size} visit{selected.size === 1 ? "" : "s"}? Their transcripts and documents are removed too.
                      </span>
                      <button className="secondary" disabled={bulkBusy} onClick={async () => {
                        setBulkBusy(true);
                        try {
                          const r = await deleteVisits(session, [...selected]);
                          setMessage(`Deleted ${r.deleted} visit${r.deleted === 1 ? "" : "s"}.` + (r.notFound ? ` ${r.notFound} were already gone.` : ""));
                          setSelected(new Set());
                        } catch (e) {
                          setMessage(visitErrorMessage(e));
                        } finally {
                          setConfirmBulk(false);
                          setBulkBusy(false);
                          void load();
                        }
                      }}>Yes, delete {selected.size}</button>
                      <button className="secondary" onClick={() => setConfirmBulk(false)}>Keep</button>
                    </>
                  ) : (
                    <button className="secondary" onClick={() => setConfirmBulk(true)}>Delete selected ({selected.size})</button>
                  )}
                </div>
              )}
              <table className="board">
                <thead><tr><th><input type="checkbox" aria-label="Select all visits" checked={visits.length > 0 && selected.size === visits.length} onChange={(e) => setSelected(e.target.checked ? new Set(visits.map((v) => v.id)) : new Set())} /></th><th>Patient</th><th>Time</th><th>Program</th><th>Type</th><th>Status</th><th /></tr></thead>
                <tbody>
                  {displayVisits(visits, showFull && canShowFullNames(visits)).map((v) => (
                    <Row key={v.id} visit={v} date={date}
                      selected={selected.has(v.id)}
                      onSelect={(on) => setSelected((cur) => { const n = new Set(cur); if (on) n.add(v.id); else n.delete(v.id); return n; })} state={rows[v.id] ?? { phase: "idle" }} ready={ready && !!session}
                      queued={queuedIds.has(v.id)} queueItem={queue.find((q) => q.visit_id === v.id)} env={env}
                      onState={setRow} engine={engine!} session={session}
                      onSent={() => { void load(); void loadQueue(); }} />
                  ))}
                </tbody>
              </table>
              </>
            )}
            <p className="small">
              The recording stays on this Mac and is never saved. It is turned into text here, and only the text is sent
              to the practice app, where the notes are written. Until the practice app confirms it, the text is kept
              encrypted on this Mac. Recording picks up your microphone and, when a call is playing through this Mac, the
              other person's voice as well. If nothing comes from the speakers, only your voice is transcribed. To capture the other side of a call, allow Practice Recorder under System Settings &gt; Privacy &amp; Security &gt; System Audio Recording (it is not a Screen Recording permission, and no picture of your screen is ever taken).
            </p>
          </>
        )}
      </main>
      <footer className={`buildbar ${env}`} role="status" data-testid="buildbar">
        <strong>{labelFor(env).toUpperCase()}</strong> <span>v{__APP_VERSION__} ({__APP_COMMIT__})</span>
      </footer>
    </>
  );
}

/** Option lists from the server, topped up with what is already on the loaded day when the server has no list. */
function mergeOptions(server: VisitOptions | null, visits: Visit[], provider: string): VisitOptions {
  return formChoices(server, visits, { provider });
}

/** One visit by hand, sent straight to the practice app. Use made-up names when testing. */
function AddVisit({ date, options, provider, onProvider, onDone, create }: {
  date: string; options: VisitOptions; provider: string; onProvider: (p: string) => void; onDone: (message: string) => void;
  create: (v: import("./lib/api").NewVisit) => Promise<unknown>;
}) {
  const [patient, setPatient] = useState("");
  const [program, setProgram] = useState("");
  const [time, setTime] = useState("");
  const [type, setType] = useState("");
  const [busy, setBusy] = useState(false);
  const [tried, setTried] = useState(false);
  const [failure, setFailure] = useState("");
  const cleanTime = normalizeTime(time);
  const errors = visitFormErrors({ date, patient, time, type, provider });
  const invalid = Object.values(errors).some(Boolean);
  const show = (m: string) => tried && m && <div className="small err" role="alert">{m}</div>;
  return (
    <div className="card">
      <h2 style={{ marginTop: 0 }}>Add one visit</h2>
      <p className="small">For {longDate(date)}.</p>
      {show(errors.date)}
      <label className="field"><span>Client (First Last)</span><input value={patient} onChange={(e) => setPatient(e.target.value)} placeholder="Alpha Testcase" />{show(errors.patient)}</label>
      <label className="field"><span>Time</span><TimeField value={time} onChange={setTime} /></label>
      <label className="field"><span>Program</span><ComboField label="Program" value={program} onChange={setProgram} options={options.programs} placeholder="KIOP-AM" /></label>
      <label className="field"><span>Type</span><StrictSelect label="Type" value={type} onChange={setType} options={options.appointmentTypes} />{show(errors.type)}</label>
      <label className="field"><span>Provider</span><StrictSelect label="Provider" value={provider} onChange={onProvider} options={options.providers} />{show(errors.provider)}</label>
      <div className="row">
        <button disabled={busy} onClick={async () => {
          setTried(true);
          setFailure("");
          if (invalid) return;
          setBusy(true);
          try {
            await create({
              patient: clientNameToSend(patient), apptTime: cleanTime || undefined, program: program.trim() || undefined,
              appointmentType: type.trim() || undefined, providerName: provider.trim() || undefined,
            });
            onDone("Added 1 visit.");
          } catch (e) {
            setFailure(visitErrorMessage(e)); // stay on the form so the reason is next to the button
          } finally {
            setBusy(false);
          }
        }}>{busy ? "Adding…" : "Add visit"}</button>
      </div>
      {failure && <div className="err" role="alert" style={{ marginTop: 8 }}>The visit was not added. {failure}</div>}
    </div>
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

function Row({ visit, date, queueItem, selected, onSelect, state, ready, queued, env, onState, engine, session, onSent }: {
  visit: Visit; date: string; queueItem: QueueItem | undefined; selected: boolean; onSelect: (on: boolean) => void; state: RowState; ready: boolean; queued: boolean; env: EnvironmentId;
  onState: (id: string, s: RowState) => void;
  engine: Engine; session: Session; onSent: () => void;
}) {
  const [secs, setSecs] = useState(0);
  const [busy, setBusy] = useState(false);
  const [confirmDelete, setConfirmDelete] = useState(false);
  const [promoteAsk, setPromoteAsk] = useState(false);
  const [promoting, setPromoting] = useState(false);
  const [promoteMsg, setPromoteMsg] = useState("");
  const [promoted, setPromoted] = useState(() => isPromoted(visit.id));
  const [viewing, setViewing] = useState(false);
  // "Which speaker is the patient?" question after a one-microphone recording; resolves with the chosen label or null.
  const [ask, setAsk] = useState<{ speakers: { label: string; sample: string }[]; resolve: (patient: string | null) => void } | null>(null);
  const askSpeaker = (speakers: { label: string; sample: string }[]) => new Promise<string | null>((resolve) => setAsk({ speakers, resolve }));
  const [chooser, setChooser] = useState(false);
  const [askAppend, setAskAppend] = useState(false);
  // Earlier text of this visit, held in memory while the new recording runs; `fromQueue` says where it came from.
  const earlier = useRef<{ text: string; fromQueue: boolean } | null>(null);
  const gen = useSyncExternalStore(subscribe, () => generationFor(visit.id));
  const canGenerate = visit.hasTranscript || state.phase === "sent";
  const hasExisting = canGenerate || queued || !!queueItem;
  // When a generation finishes, refresh the day so the note count updates.
  useEffect(() => { if (gen?.phase === "done") onSent(); }, [gen?.phase]);
  const since = state.phase === "recording" ? state.since : 0;

  useEffect(() => {
    if (!since) return;
    const t = setInterval(() => setSecs(Math.round((Date.now() - since) / 1000)), 500);
    return () => clearInterval(t);
  }, [since]);

  /** Record on a visit that already has a transcript: read the earlier text first, so adding never loses it. */
  async function startAdding() {
    setAskAppend(false);
    setBusy(true);
    try {
      const fromQueue = !!queueItem;
      const text = fromQueue ? await engine.queueText(visit.id) : (await fetchTranscript(session, visit.id)).transcript;
      earlier.current = text.trim() ? { text, fromQueue } : null;
    } catch {
      setBusy(false);
      return onState(visit.id, { phase: "failed", message: "Could not read the existing transcript, so nothing was recorded. Try again." });
    }
    await start();
  }

  async function start() {
    setBusy(true);
    try {
      const { warning } = await engine.startRecording(true);
      setSecs(0);
      onState(visit.id, { phase: "recording", since: Date.now(), warning: warning ?? undefined });
    } catch (e) {
      earlier.current = null;
      onState(visit.id, { phase: "failed", message: e instanceof Error ? e.message : String(e) });
    } finally {
      setBusy(false);
    }
  }

  async function promote() {
    setPromoting(true); setPromoteMsg("");
    try {
      const prod = await sessionFor(engine, "production");
      if (!prod) { setPromoteMsg("Sign in to Production first (Setup tab, choose Production). Nothing was changed."); return; }
      const r = await promoteVisit(visit, date, {
        readTranscript: async () => (await fetchTranscript(session, visit.id)).transcript,
        listProduction: async (d) => (await fetchVisits(prod, d)).visits,
        createProduction: (d, v) => createVisit(prod, d, v),
        pushProduction: (id, text) => pushTranscript(prod, id, text),
      });
      if (r.ok) { markPromoted(visit.id, r.productionId); setPromoted(true); setPromoteMsg(r.already ? "Already in Production." : "Promoted to Production."); }
      else setPromoteMsg(r.message);
    } catch (e) {
      setPromoteMsg(e instanceof Error ? e.message : "Promote failed. Nothing was lost.");
    } finally { setPromoting(false); setPromoteAsk(false); }
  }

  async function stop() {
    setBusy(true);
    try {
      onState(visit.id, { phase: "working", detail: "transcribing on this Mac" });
      // The transcript is saved (encrypted) on this Mac before anything is sent.
      const prev = earlier.current;
      const summary = await engine.stopRecording(visit.id, env, prev?.text, prev ? addedSeparator(new Date()) : undefined);
      if (summary.needs_speaker_choice) {
        // One microphone, two voices: ask which speaker is the patient before anything is sent. Closing the question
        // keeps "Speaker 1" / "Speaker 2" (they can be renamed later from the transcript window).
        onState(visit.id, { phase: "working", detail: "waiting for you to say which speaker is the patient" });
        const patient = await askSpeaker(summary.speakers);
        if (patient) await engine.queueRelabel(visit.id, patientChoice(patient, summary.speakers.map((x) => x.label)));
      }
      onState(visit.id, { phase: "working", detail: "sending to the practice app" });
      const item = (await engine.queueList()).find((q) => q.visit_id === visit.id);
      setCopyLabel(visit.id, `${visit.realInitials ?? visit.initials}_${date}_${(visit.apptTime ?? "").replace(/[^0-9apmAPM]/g, "") || "notime"}`);
      const result = item ? await uploadQueued(engine, item, session) : { ok: false, reason: "missing" };
      onState(visit.id, result.ok ? { phase: "sent", note: result.reason } : { phase: "saved", reason: SAVED_MESSAGE });
      onSent();
    } catch (e) {
      onState(visit.id, { phase: "failed", message: e instanceof Error ? e.message : String(e) });
    } finally {
      earlier.current = null;
      setBusy(false);
    }
  }

  const mmss = `${String(Math.floor(secs / 60)).padStart(2, "0")}:${String(secs % 60).padStart(2, "0")}`;

  return (
    <tr>
      <td><input type="checkbox" aria-label={`Select visit for ${visit.initials}`} checked={selected} onChange={(e) => onSelect(e.target.checked)} /></td>
      <td title={visit.fullName && visit.initials === visit.fullName ? "Full name" : "Shown as initials"}>{visit.initials}</td>
      <td style={{ whiteSpace: "nowrap" }}>
        <TimeCell
          value={visit.apptTime ?? ""}
          disabled={busy || state.phase === "recording" || state.phase === "working"}
          onSave={async (v) => {
            try { await updateVisit(session, visit.id, { apptTime: v }); onSent(); }
            catch (err) { onState(visit.id, { phase: "failed", message: visitErrorMessage(err) }); throw err; }
          }}
        />
      </td>
      <td>{visit.program}</td>
      <td>{visit.appointmentType}</td>
      <td className="small">
        {state.phase === "recording" && state.warning && <span className="err">{state.warning}</span>}
        {state.phase === "working" && state.detail}
        {state.phase === "failed" && <span className="err">{state.message}</span>}
        {state.phase === "saved" && <span className="err">{state.reason}</span>}
        {gen?.phase === "running" && <div>Writing the documents… this can take up to 2 minutes. You can leave this screen.</div>}
        {gen?.phase === "failed" && <div className="err">{gen.message}</div>}
        {gen?.phase === "done" && <div>{gen.documents.length ? "Documents ready." : ""}{gen.failedTypes.length > 0 && <span className="err"> Could not write: {gen.failedTypes.join(", ")}.</span>}</div>}
        {state.phase === "sent" && <>Transcript sent{state.note && <span className="err"> ({state.note})</span>}</>}
        {state.phase === "idle" && queued && <span className="err">{SAVED_MESSAGE}</span>}
        {state.phase === "idle" && !queued && (visit.hasTranscript ? `Transcript on file${visit.documentCount ? `, ${visit.documentCount} documents` : ""}` : "")}
      </td>
      <td className="actions"><div className="acts">
        <button className="secondary" title="View the transcript (read-only)" aria-label="View transcript" onClick={() => setViewing(true)}>
          <svg width="14" height="14" viewBox="0 0 16 16" aria-hidden="true" fill="none" stroke="currentColor" strokeWidth="1.5"><path d="M3 1.5h7l3 3V14.5H3z" /><path d="M5.5 8h5M5.5 10.5h5M5.5 5.5h2.5" /></svg>
        </button>
        {ask && <SpeakerDialog speakers={ask.speakers} onChoose={(p) => { ask.resolve(p); setAsk(null); }} />}
        {viewing && !ask && (
          <TranscriptDialog
            visit={visit} date={date} queued={queued} queueItem={queueItem} engine={engine} session={session}
            status={{ phase: state.phase, reason: state.phase === "failed" ? state.message : undefined }}
            onClose={() => setViewing(false)}
          />
        )}
        {chooser && (
          <GenerateDialog visit={visit} session={session} onClose={() => setChooser(false)}
            onStart={(types) => { clearGeneration(visit.id); void startGenerate(session, visit.id, types); }} />
        )}
        <DocumentIcons visit={visit} session={session} refreshKey={gen?.phase === "done" ? "done" : ""} />
        <button className="secondary" disabled={!canGenerate || visit.documentCount > 0 || gen?.phase === "done" || gen?.phase === "running" || state.phase === "recording" || state.phase === "working"}
          title={visit.documentCount > 0 || gen?.phase === "done" ? "The documents are already generated. Open them with the icons." : canGenerate ? "Write the documents from the transcript (can take up to 2 minutes; you can leave this screen)" : "Record the visit first: there is no transcript yet"}
          onClick={() => setChooser(true)}>
          {gen?.phase === "running" ? "Generating…" : "Generate documents"}
        </button>
        {state.phase === "recording" ? (
          <>
            <span className="rec"><span className="dot" />{mmss}</span>
            <button onClick={stop} disabled={busy}>Stop</button>
            <button className="secondary" disabled={busy} onClick={async () => {
              await engine.cancelRecording();
              earlier.current = null;
              onState(visit.id, { phase: "idle" });
            }}>Discard</button>
          </>
        ) : state.phase === "working" ? (
          <span className="small">Working…</span>
        ) : (
          <>
          <button className="record" disabled={!ready || busy} onClick={() => (hasExisting ? setAskAppend(true) : start())}>
            Record
          </button>
          {askAppend && (
            <Modal title="This visit already has a transcript" onClose={() => setAskAppend(false)} width={460}
              footer={<>
                <button className="secondary" onClick={() => setAskAppend(false)}>No</button>
                <button onClick={startAdding}>Yes, append</button>
              </>}>
              <p style={{ marginTop: 0 }}>Append the new recording to it? The earlier text is kept, and the new text is added after a time line.</p>
            </Modal>
          )}
          </>
        )}
        {env === "staging" && state.phase !== "recording" && state.phase !== "working" && (
          <>
            <button className="secondary" disabled={promoted || promoting || !!promoteBlocker(visit)}
              title={promoted ? "Already promoted to Production" : promoteBlocker(visit) || "Copy this visit and its transcript to the real Production app"}
              onClick={() => setPromoteAsk(true)}>{promoted ? "Promoted" : promoting ? "Promoting…" : "Promote to production"}</button>
            {promoteAsk && (
              <Modal title="Promote to production?" onClose={() => setPromoteAsk(false)} width={480}
                footer={<>
                  <button className="secondary" onClick={() => setPromoteAsk(false)}>Cancel</button>
                  <button disabled={promoting} onClick={() => void promote()}>{promoting ? "Promoting…" : "Yes, promote"}</button>
                </>}>
                <p style={{ marginTop: 0 }}>This copies the visit for <strong>{visit.fullName}</strong>{visit.apptTime ? ` at ${visit.apptTime}` : ""} and its transcript to the <strong>real Production app</strong>. After that this button stays off for this visit.</p>
              </Modal>
            )}
          </>
        )}
        {promoteMsg && <div className="small" role="status" style={{ flexBasis: "100%", textAlign: "right" }}>{promoteMsg}</div>}
        {state.phase !== "recording" && state.phase !== "working" && (
          <>
            <button className="secondary" disabled={busy} title="Remove this row from the day's list" onClick={() => setConfirmDelete(true)}>Delete</button>
            {confirmDelete && (
              <Modal title="Delete this record?" onClose={() => setConfirmDelete(false)} width={460}
                footer={<>
                  <button className="secondary" onClick={() => setConfirmDelete(false)}>Keep it</button>
                  <button className="danger" disabled={busy} onClick={async () => {
                    setBusy(true);
                    try {
                      await deleteVisit(session, visit.id);
                      setConfirmDelete(false);
                      onSent();
                    } catch (e) {
                      setConfirmDelete(false);
                      onState(visit.id, { phase: "failed", message: visitErrorMessage(e) });
                    } finally {
                      setBusy(false);
                    }
                  }}>Yes, delete</button>
                </>}>
                <p style={{ marginTop: 0 }}>Are you sure you want to delete the record for <strong>{visit.initials}</strong>{visit.apptTime ? ` at ${visit.apptTime}` : ""}? Its transcript and documents are deleted too. This cannot be undone.</p>
              </Modal>
            )}
          </>
        )}
      </div></td>
    </tr>
  );
}

function Setup({ engine, status, env, signedIn, session, locked, onEnvironment, onChanged }: {
  engine: Engine; status: EngineStatus; env: EnvironmentId; signedIn: boolean; session?: Session | null; locked: boolean;
  onEnvironment: (e: EnvironmentId) => void; onChanged: () => Promise<void> | void;
}) {
  const [signingIn, setSigningIn] = useState(false);
  const [error, setError] = useState("");
  const [diagMsg, setDiagMsg] = useState("");
  // Two-factor step in progress (token in memory only).
  const [mfa, setMfa] = useState<{ mode: "enroll" | "verify"; token: string } | null>(null);
  // null while unknown, so the button is never offered before the server has been asked.
  const [googleAvailable, setGoogleAvailable] = useState<boolean | null>(null);
  // A failed check is shown as what it is (with Retry), never as "not set up".
  const [configError, setConfigError] = useState("");
  const [attempt, setAttempt] = useState(0);
  const url = urlFor(env);

  useEffect(() => {
    setGoogleAvailable(null);
    setConfigError("");
    setError("");
    setMfa(null);
    let alive = true;
    fetchAuthConfig(url)
      .then((c) => alive && setGoogleAvailable(c.googleSignIn))
      .catch((e) => alive && setConfigError(e instanceof Error ? e.message : String(e)));
    return () => { alive = false; };
  }, [url, attempt]);

  return (
    <div className="card" style={{ maxWidth: 760 }}>
      {!signedIn && <div style={{ display: "flex", alignItems: "center", gap: ".8rem", marginBottom: ".6rem" }}>
        <img src={logo} alt="" width={72} height={72} style={{ borderRadius: 14 }} />
        <div><strong style={{ fontSize: "1.15rem" }}>Brain and Behavior Center</strong><div className="small">Practice Recorder</div></div>
      </div>}
      <h2 style={{ marginTop: 0 }}>{signedIn ? "Setup" : "Sign in"}</h2>
      <div className={`buildbadge ${env}`} data-testid="buildbadge">
        <span className="env">{labelFor(env).toUpperCase()}</span>
        <span className="ver">Build {__APP_VERSION__}</span>
        <span className="small">({__APP_COMMIT__}) · {urlFor(env).replace(/^https?:\/\//, "")}</span>
      </div>

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
        <>
          <p className="small"><strong>Signed in to {labelFor(env)}.</strong></p>
          <p className="small">
            <button className="secondary" disabled={!session} onClick={() => {
              if (!session) return;
              setDiagMsg("Sending…");
              sendDiagnostics(session, true, env)
                .then((n) => setDiagMsg(`Sent. ${n} recent event${n === 1 ? "" : "s"} (app version, errors and status codes only; no patient information).`))
                .catch(() => setDiagMsg("Could not send. Try again in a minute."));
            }}>Send diagnostics</button>{" "}
            <span className="small">{diagMsg || "Sends app version, errors and status codes to Sohail. No patient names, transcripts or audio."}</span>
          </p>
        </>
      ) : (
        <p className="small">Sign in with your Google account to use the recorder. Nothing works until you do.</p>
      )}
      {error && <p className="small err">{error}</p>}

      {configError && (
        <p className="small err">
          Could not check sign-in with the practice app: {configError}{" "}
          <button className="secondary" onClick={() => setAttempt((n) => n + 1)}>Retry</button>
        </p>
      )}

      {googleAvailable === false && (
        <p className="small">
          Google sign-in is not set up on this server yet. An administrator needs to create a Google OAuth client of type{" "}
          <strong>Desktop app</strong> and set GOOGLE_DESKTOP_CLIENT_ID and GOOGLE_DESKTOP_CLIENT_SECRET on the practice app.
        </p>
      )}

      {mfa && (
        <Mfa engine={engine} env={env} mode={mfa.mode} token={mfa.token}
          onDone={() => { setMfa(null); void onChanged(); }}
          onRestart={(m) => { setMfa(null); setError(m); }} />
      )}
      <div className="row" style={{ marginBottom: ".8rem", display: mfa ? "none" : undefined }}>
        {googleAvailable !== false && (
          <button
            disabled={signingIn || googleAvailable !== true}
            onClick={async () => {
              setSigningIn(true);
              setError("");
              try {
                const out = await engine.signInWithGoogle(env);
                if (out.mfa && out.mfaToken) setMfa({ mode: out.mfa, token: out.mfaToken });
                else await onChanged();
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

      <h3>Where transcripts are saved</h3>
      <p className="small">
        While a transcript waits for upload it is kept <strong>encrypted</strong> on this Mac, in
        ~/Library/Application Support/PracticeNotes, and deleted as soon as the practice app confirms the upload. Audio is never saved.
        To read one, use the transcript icon next to Record on the Visits screen.
      </p>
      <h3>Transcript copy</h3>
          <p className="small">
            Optional. Save a copy of each transcript to:{" "}
            <strong>{status.settings.transcript_copy_dir ?? "off"}</strong>
          </p>
          <div className="row">
            <button className="secondary" disabled={locked} onClick={async () => {
              setError("");
              try {
                const dir = await engine.chooseTranscriptDir();
                if (dir) { await engine.setTranscriptCopyDir(dir); await onChanged(); }
              } catch (e) { setError(e instanceof Error ? e.message : String(e)); }
            }}>Choose folder…</button>
            {status.settings.transcript_copy_dir && (
              <button className="secondary" onClick={async () => { await engine.setTranscriptCopyDir(null); await onChanged(); }}>Turn off</button>
            )}
          </div>
          <p className="small err">
            Warning: a copy is patient information stored as a plain file on this Mac, outside the encrypted queue. It is
            written only after the practice app confirms the upload. Choose a protected folder.
          </p>

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
