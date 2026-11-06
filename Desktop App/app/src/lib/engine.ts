// The recorder's bridge to the native side (src-tauri/src/lib.rs). In a plain browser, used for working on the
// screens, it falls back to clearly labelled fakes so nothing pretends to record or transcribe.
import type { EnvironmentId } from "./environments";

export type Settings = { environment: EnvironmentId; transcript_copy_dir?: string | null };

export type EngineStatus = {
  whisper_model: boolean;
  settings: Settings;
  /** Which environments have a stored sign-in (the tokens themselves stay in the macOS Keychain). */
  signed_in: Record<string, boolean>;
};

/** What was captured, so the UI can warn when only one side of a call was heard. */
export type StopResult = {
  seconds: number; system_audio: boolean; one_sided: boolean;
  /** Voices found on one microphone (1 or 2); 2 also when both call channels were captured. */
  voices: number;
  /** One microphone, two voices: the provider still has to say which speaker is the patient. */
  needs_speaker_choice: boolean;
  /** The first words each unconfirmed speaker said, only to help choose. Never stored or logged. */
  speakers: { label: string; sample: string }[];
};

/** A transcript saved on this Mac, waiting for the server to confirm it. */
export type QueueItem = {
  visit_id: string;
  environment: EnvironmentId;
  created_at: string;
  duration_seconds: number;
  status: "pending" | "uploaded";
};

/** `mfa` is set when a two-factor step is still to do; `mfaToken` is its single-use step token (memory only). */
export type SignInOutcome = { mfa: "enroll" | "verify" | null; mfaToken: string | null };
export type MfaStep = "enroll_start" | "enroll_confirm" | "verify";

export interface Engine {
  readonly kind: "native" | "fake";
  status(): Promise<EngineStatus>;
  setEnvironment(environment: EnvironmentId): Promise<Settings>;
  /** Opens the system browser to sign in with Google; the tokens go to the Keychain. */
  signInWithGoogle(environment: EnvironmentId): Promise<SignInOutcome>;
  /** One two-factor step (tokens stay in the Rust side). Returns the HTTP status and the reply body. */
  mfaStep(environment: EnvironmentId, step: MfaStep, body: object): Promise<{ status: number; body: string }>;
  /** After the recovery codes were saved: completes the sign-in. */
  mfaFinish(environment: EnvironmentId): Promise<void>;
  mfaCancel(): Promise<void>;
  signOut(environment: EnvironmentId): Promise<void>;
  accessToken(environment: EnvironmentId): Promise<string | null>;
  /** Renews the sign-in after a 401. Null when the server refused the refresh token. */
  refreshAccessToken(environment: EnvironmentId, stale: string): Promise<string | null>;
  /** Records the microphone and, for a telehealth visit, the system audio. */
  startRecording(withSystemAudio: boolean): Promise<{ warning: string | null }>;
  /** Stops, transcribes on this Mac, and saves the transcript in the encrypted queue under the visit id. */
  /** `previous` is earlier text for the same visit to keep in front of this recording, after `separator`. */
  stopRecording(visitId: string, environment: EnvironmentId, previous?: string, separator?: string): Promise<StopResult>;
  cancelRecording(): Promise<void>;
  /** Stops a microphone-only dictation and returns the transcript. Nothing is saved on disk. */
  stopDictation(): Promise<string>;
  queueList(): Promise<QueueItem[]>;
  queueText(visitId: string): Promise<string>;
  /** Puts the saved transcript back to exactly this text (undoes an addition). */
  queueSetText(visitId: string, environment: EnvironmentId, text: string): Promise<void>;
  /** Renames speakers in the saved transcript before it is sent, e.g. {"Speaker 1": "Provider", "Speaker 2": "Patient"}. */
  queueRelabel(visitId: string, mapping: Record<string, string>): Promise<void>;
  /** Marks the folder uploaded and shreds it. Only called after the server confirmed. */
  queueComplete(visitId: string): Promise<void>;
  queueDiscard(visitId: string): Promise<void>;
  /** Opens the folder chooser. Null if cancelled. */
  chooseTranscriptDir(): Promise<string | null>;
  /** Turns the plain-text transcript copy on (a folder) or off (null). */
  setTranscriptCopyDir(dir: string | null): Promise<Settings>;
  /** Writes the copy of an uploaded transcript, if enabled. True when a file was written. */
  saveTranscriptCopy(visitId: string, label: string): Promise<boolean>;
}

const isTauri = () => typeof window !== "undefined" && "__TAURI_INTERNALS__" in window;

async function nativeEngine(): Promise<Engine> {
  const { invoke } = await import("@tauri-apps/api/core");
  return {
    kind: "native",
    status: () => invoke<EngineStatus>("engine_status_cmd"),
    setEnvironment: (environment) => invoke<Settings>("set_environment", { environment }),
    signInWithGoogle: (environment) => invoke<SignInOutcome>("sign_in_with_google", { environment }),
    mfaStep: async (environment, step, body) => {
      const [status, text] = await invoke<[number, string]>("mfa_step", { environment, step, body: JSON.stringify(body) });
      return { status, body: text };
    },
    mfaFinish: (environment) => invoke<void>("mfa_finish", { environment }),
    mfaCancel: () => invoke<void>("mfa_cancel"),
    signOut: (environment) => invoke<void>("sign_out", { environment }),
    accessToken: (environment) => invoke<string | null>("get_access_token", { environment }),
    refreshAccessToken: (environment, stale) => invoke<string | null>("refresh_access_token", { environment, stale }),
    startRecording: (withSystemAudio) => invoke<{ warning: string | null }>("start_recording", { withSystemAudio }),
    stopRecording: (visitId, environment, previous, separator) =>
      invoke<StopResult>("stop_recording", { visitId, environment, previous: previous ?? null, separator: separator ?? null }),
    cancelRecording: () => invoke<void>("cancel_recording"),
    stopDictation: () => invoke<string>("stop_dictation"),
    queueList: () => invoke<QueueItem[]>("queue_list"),
    queueText: (visitId) => invoke<string>("queue_text", { visitId }),
    queueSetText: (visitId, environment, text) => invoke<void>("queue_set_text", { visitId, environment, text }),
    queueRelabel: (visitId, mapping) => invoke<void>("queue_relabel", { visitId, mapping }),
    queueComplete: (visitId) => invoke<void>("queue_complete", { visitId }),
    chooseTranscriptDir: () => invoke<string | null>("choose_transcript_dir"),
    setTranscriptCopyDir: (dir) => invoke<Settings>("set_transcript_copy_dir", { dir }),
    saveTranscriptCopy: (visitId, label) => invoke<boolean>("save_transcript_copy", { visitId, label }),
    queueDiscard: (visitId) => invoke<void>("queue_discard", { visitId }),
  };
}

const FAKE_TRANSCRIPT =
  "[00:00] Provider: FAKE ENGINE, nothing was recorded. How have you been?\n" +
  "[00:06] Patient: Better, I am sleeping about seven hours now. I deny any thoughts of suicide.";

/** `?qa=1` in a plain browser (dev only): looks signed in to localhost, so every screen can be seen against tests/qa/mock-server.mjs. */
const qaMode = () => typeof location !== "undefined" && location.search.includes("qa=1");

function fakeEngine(): Engine {
  let environment: EnvironmentId = "localhost";
  const tokens: Record<string, string> = qaMode() ? { localhost: "qa-token" } : {};
  const queue = new Map<string, QueueItem>();
  return {
    kind: "fake",
    status: async () => ({
      whisper_model: qaMode(),
      settings: { environment },
      signed_in: { production: !!tokens.production, staging: !!tokens.staging, localhost: !!tokens.localhost },
    }),
    setEnvironment: async (e) => ((environment = e), { environment }),
    signInWithGoogle: async () => { throw new Error("Signing in only works in the real app."); },
    mfaStep: async () => { throw new Error("Signing in only works in the real app."); },
    mfaFinish: async () => { throw new Error("Signing in only works in the real app."); },
    mfaCancel: async () => {},
    signOut: async (e) => { delete tokens[e]; },
    accessToken: async (e) => tokens[e] ?? null,
    refreshAccessToken: async () => null,
    startRecording: async () => ({ warning: "Fake engines: nothing is being recorded." }),
    stopRecording: async (visitId, env, previous, separator) => {
      queue.set(visitId, { visit_id: visitId, environment: env, created_at: new Date().toISOString(), duration_seconds: 12, status: "pending" });
      const two = typeof location !== "undefined" && new URLSearchParams(location.search).has("speakers");
      return {
        seconds: 12, system_audio: !two, one_sided: false, voices: 2, needs_speaker_choice: two,
        speakers: two ? [{ label: "Speaker 1", sample: "Good morning, how have you been sleeping?" }, { label: "Speaker 2", sample: "Not great. I wake up a lot." }] : [],
      };
    },
    cancelRecording: async () => {},
    stopDictation: async () => FAKE_TRANSCRIPT,
    queueList: async () => [...queue.values()],
    queueText: async () => FAKE_TRANSCRIPT,
    queueSetText: async () => {},
    queueRelabel: async () => {},
    queueComplete: async (id) => { queue.delete(id); },
    queueDiscard: async (id) => { queue.delete(id); },
    chooseTranscriptDir: async () => null,
    setTranscriptCopyDir: async (dir) => ({ environment, transcript_copy_dir: dir }),
    saveTranscriptCopy: async () => false,
  };
}

let cached: Promise<Engine> | null = null;
export const getEngine = (): Promise<Engine> => (cached ??= isTauri() ? nativeEngine() : Promise.resolve(fakeEngine()));
