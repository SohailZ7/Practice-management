// The recorder's bridge to the native side (src-tauri/src/lib.rs). In a plain browser, used for working on the
// screens, it falls back to clearly labelled fakes so nothing pretends to record or transcribe.

export type Settings = {
  practice_url: string;
  access_token: string;
  whisper_model: string;
};

export type EngineStatus = {
  ffmpeg: boolean;
  whisper_cli: boolean;
  whisper_model: boolean;
  settings: Settings;
};

export interface Engine {
  readonly kind: "native" | "fake";
  status(): Promise<EngineStatus>;
  getSettings(): Promise<Settings>;
  setSettings(s: Settings): Promise<Settings>;
  transcribe(audio: Uint8Array, ext: string): Promise<string>;
}

const isTauri = () => typeof window !== "undefined" && "__TAURI_INTERNALS__" in window;

async function nativeEngine(): Promise<Engine> {
  const { invoke } = await import("@tauri-apps/api/core");
  return {
    kind: "native",
    status: () => invoke<EngineStatus>("engine_status_cmd"),
    getSettings: () => invoke<Settings>("get_settings"),
    setSettings: (settings) => invoke<Settings>("set_settings", { settings }),
    transcribe: (audio, ext) => invoke<string>("transcribe", audio, { headers: { "x-ext": ext } }),
  };
}

function fakeEngine(): Engine {
  let settings: Settings = { practice_url: "http://localhost:3000", access_token: "", whisper_model: "(none)" };
  return {
    kind: "fake",
    status: async () => ({ ffmpeg: false, whisper_cli: false, whisper_model: false, settings }),
    getSettings: async () => settings,
    setSettings: async (s) => ((settings = s), s),
    transcribe: async () =>
      "FAKE ENGINE, nothing was recorded. Doctor: how have you been? Patient: better, I am sleeping about seven " +
      "hours now. I deny any thoughts of suicide.",
  };
}

let cached: Promise<Engine> | null = null;
export const getEngine = (): Promise<Engine> => (cached ??= isTauri() ? nativeEngine() : Promise.resolve(fakeEngine()));
