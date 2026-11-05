// The recorder's bridge to the native side (src-tauri/src/lib.rs). In a plain browser, used for working on the
// screens, it falls back to clearly labelled fakes so nothing pretends to record or transcribe.
import type { EnvironmentId } from "./environments";

export type Settings = { environment: EnvironmentId };

export type EngineStatus = {
  whisper_model: boolean;
  settings: Settings;
  /** Which environments have a stored sign-in (the tokens themselves stay in the macOS Keychain). */
  signed_in: Record<string, boolean>;
};

/** What was captured, so the UI can warn when only one side of a call was heard. */
export type StopResult = { seconds: number; system_audio: boolean; one_sided: boolean };

/** A transcript saved on this Mac, waiting for the server to confirm it. */
export type QueueItem = {
  visit_id: string;
  environment: EnvironmentId;
  created_at: string;
  duration_seconds: number;
  status: "pending" | "uploaded";
};

export interface Engine {
  readonly kind: "native" | "fake";
  status(): Promise<EngineStatus>;
  setEnvironment(environment: EnvironmentId): Promise<Settings>;
  /** Opens the system browser to sign in with Google; the tokens go to the Keychain. */
  signInWithGoogle(environment: EnvironmentId): Promise<void>;
  signOut(environment: EnvironmentId): Promise<void>;
  accessToken(environment: EnvironmentId): Promise<string | null>;
  /** Renews the sign-in after a 401. Null when the server refused the refresh token. */
  refreshAccessToken(environment: EnvironmentId, stale: string): Promise<string | null>;
  /** Records the microphone and, for a telehealth visit, the system audio. */
  startRecording(withSystemAudio: boolean): Promise<{ warning: string | null }>;
  /** Stops, transcribes on this Mac, and saves the transcript in the encrypted queue under the visit id. */
  stopRecording(visitId: string, environment: EnvironmentId): Promise<StopResult>;
  cancelRecording(): Promise<void>;
  queueList(): Promise<QueueItem[]>;
  queueText(visitId: string): Promise<string>;
  /** Marks the folder uploaded and shreds it. Only called after the server confirmed. */
  queueComplete(visitId: string): Promise<void>;
  queueDiscard(visitId: string): Promise<void>;
}

const isTauri = () => typeof window !== "undefined" && "__TAURI_INTERNALS__" in window;

async function nativeEngine(): Promise<Engine> {
  const { invoke } = await import("@tauri-apps/api/core");
  return {
    kind: "native",
    status: () => invoke<EngineStatus>("engine_status_cmd"),
    setEnvironment: (environment) => invoke<Settings>("set_environment", { environment }),
    signInWithGoogle: (environment) => invoke<void>("sign_in_with_google", { environment }),
    signOut: (environment) => invoke<void>("sign_out", { environment }),
    accessToken: (environment) => invoke<string | null>("get_access_token", { environment }),
    refreshAccessToken: (environment, stale) => invoke<string | null>("refresh_access_token", { environment, stale }),
    startRecording: (withSystemAudio) => invoke<{ warning: string | null }>("start_recording", { withSystemAudio }),
    stopRecording: (visitId, environment) => invoke<StopResult>("stop_recording", { visitId, environment }),
    cancelRecording: () => invoke<void>("cancel_recording"),
    queueList: () => invoke<QueueItem[]>("queue_list"),
    queueText: (visitId) => invoke<string>("queue_text", { visitId }),
    queueComplete: (visitId) => invoke<void>("queue_complete", { visitId }),
    queueDiscard: (visitId) => invoke<void>("queue_discard", { visitId }),
  };
}

const FAKE_TRANSCRIPT =
  "FAKE ENGINE, nothing was recorded. Doctor: how have you been? Patient: better, I am sleeping about seven " +
  "hours now. I deny any thoughts of suicide.";

function fakeEngine(): Engine {
  let environment: EnvironmentId = "localhost";
  const tokens: Record<string, string> = {};
  const queue = new Map<string, QueueItem>();
  return {
    kind: "fake",
    status: async () => ({
      whisper_model: false,
      settings: { environment },
      signed_in: { production: !!tokens.production, staging: !!tokens.staging, localhost: !!tokens.localhost },
    }),
    setEnvironment: async (e) => ((environment = e), { environment }),
    signInWithGoogle: async () => { throw new Error("Signing in only works in the real app."); },
    signOut: async (e) => { delete tokens[e]; },
    accessToken: async (e) => tokens[e] ?? null,
    refreshAccessToken: async () => null,
    startRecording: async () => ({ warning: "Fake engines: nothing is being recorded." }),
    stopRecording: async (visitId, env) => {
      queue.set(visitId, { visit_id: visitId, environment: env, created_at: new Date().toISOString(), duration_seconds: 12, status: "pending" });
      return { seconds: 12, system_audio: true, one_sided: false };
    },
    cancelRecording: async () => {},
    queueList: async () => [...queue.values()],
    queueText: async () => FAKE_TRANSCRIPT,
    queueComplete: async (id) => { queue.delete(id); },
    queueDiscard: async (id) => { queue.delete(id); },
  };
}

let cached: Promise<Engine> | null = null;
export const getEngine = (): Promise<Engine> => (cached ??= isTauri() ? nativeEngine() : Promise.resolve(fakeEngine()));
