// The recorder's bridge to the native side (src-tauri/src/lib.rs). In a plain browser, used for working on the
// screens, it falls back to clearly labelled fakes so nothing pretends to record or transcribe.

export type Settings = {
  practice_url: string;
  access_token: string;
  refresh_token: string;
  whisper_model: string;
};

export type EngineStatus = {
  ffmpeg: boolean;
  whisper_cli: boolean;
  whisper_model: boolean;
  settings: Settings;
};

/** What was captured, so the UI can warn when only one side of a call was heard. */
export type StopResult = { seconds: number; system_audio: boolean; one_sided: boolean };

export interface Engine {
  readonly kind: "native" | "fake";
  status(): Promise<EngineStatus>;
  getSettings(): Promise<Settings>;
  setSettings(s: Settings): Promise<Settings>;
  /** Records the microphone and, for a telehealth visit, the system audio. */
  startRecording(withSystemAudio: boolean): Promise<{ warning: string | null }>;
  /** Stops, transcribes on this Mac, and returns the text. */
  stopRecording(): Promise<[string, StopResult]>;
  cancelRecording(): Promise<void>;
  /** Opens the system browser to sign in with Google, and stores the tokens the practice app issues. */
  signInWithGoogle(practiceUrl: string): Promise<Settings>;
  /** Transcribes an audio file the provider picked, used for testing without a microphone. */
  transcribe(audio: Uint8Array, ext: string): Promise<string>;
}

const FAKE_TRANSCRIPT =
  "FAKE ENGINE, nothing was recorded. Doctor: how have you been? Patient: better, I am sleeping about seven " +
  "hours now. I deny any thoughts of suicide.";

const isTauri = () => typeof window !== "undefined" && "__TAURI_INTERNALS__" in window;

async function nativeEngine(): Promise<Engine> {
  const { invoke } = await import("@tauri-apps/api/core");
  return {
    kind: "native",
    status: () => invoke<EngineStatus>("engine_status_cmd"),
    getSettings: () => invoke<Settings>("get_settings"),
    setSettings: (settings) => invoke<Settings>("set_settings", { settings }),
    startRecording: (withSystemAudio) => invoke<{ warning: string | null }>("start_recording", { withSystemAudio }),
    stopRecording: () => invoke<[string, StopResult]>("stop_recording"),
    cancelRecording: () => invoke<void>("cancel_recording"),
    signInWithGoogle: (practiceUrl) => invoke<Settings>("sign_in_with_google", { practiceUrl }),
    transcribe: (audio, ext) => invoke<string>("transcribe", audio, { headers: { "x-ext": ext } }),
  };
}

function fakeEngine(): Engine {
  let settings: Settings = { practice_url: "http://localhost:3000", access_token: "", refresh_token: "", whisper_model: "(none)" };
  return {
    kind: "fake",
    status: async () => ({ ffmpeg: false, whisper_cli: false, whisper_model: false, settings }),
    getSettings: async () => settings,
    setSettings: async (s) => ((settings = s), s),
    startRecording: async () => ({ warning: "Fake engines: nothing is being recorded." }),
    stopRecording: async () => [FAKE_TRANSCRIPT, { seconds: 12, system_audio: true, one_sided: false }],
    cancelRecording: async () => {},
    signInWithGoogle: async () => { throw new Error("Signing in only works in the real app."); },
    transcribe: async () => FAKE_TRANSCRIPT,
  };
}

let cached: Promise<Engine> | null = null;
export const getEngine = (): Promise<Engine> => (cached ??= isTauri() ? nativeEngine() : Promise.resolve(fakeEngine()));
