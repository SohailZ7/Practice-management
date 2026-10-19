// The app's bridge to the local engines. Inside the Tauri window it calls the native commands (src-tauri/src/lib.rs).
// In a plain browser (npm run dev, used for UI work and tests) it uses clearly labeled fake engines, so the screens can be
// exercised without a microphone, Whisper or a language model.
import type { Llm } from "./types";
import templateUrl from "../../../../Templates/Psychiatric_Master_Template_v2.docx?url";

export type EngineStatus = {
  ffmpeg: boolean;
  whisper_cli: boolean;
  whisper_model: boolean;
  ollama: boolean;
  models: string[];
  notes_root: string;
};

export interface Engine {
  readonly kind: "native" | "fake";
  status(): Promise<EngineStatus>;
  transcribe(audio: Uint8Array, ext: string): Promise<string>;
  llm(model: string): Llm;
  readTemplate(): Promise<Uint8Array>;
  listNotes(folder: string): Promise<string[]>;
  readNote(folder: string, file: string): Promise<Uint8Array>;
  saveNote(folder: string, file: string, bytes: Uint8Array): Promise<string>;
}

const isTauri = () => typeof window !== "undefined" && "__TAURI_INTERNALS__" in window;

async function nativeEngine(): Promise<Engine> {
  const { invoke } = await import("@tauri-apps/api/core");
  const bytes = (b: ArrayBuffer | number[]) => new Uint8Array(b as ArrayBuffer);
  return {
    kind: "native",
    status: () => invoke<EngineStatus>("engine_status_cmd"),
    transcribe: (audio, ext) => invoke<string>("transcribe", audio, { headers: { "x-ext": ext } }),
    llm: (model) => ({ system, prompt }) => invoke<string>("llm_complete", { model, system, prompt }),
    readTemplate: async () => bytes(await invoke<ArrayBuffer>("read_template")),
    listNotes: (folder) => invoke<string[]>("list_notes", { folder }),
    readNote: async (folder, file) => bytes(await invoke<ArrayBuffer>("read_note", { folder, file })),
    saveNote: (folder, file, data) => invoke<string>("save_note", data, { headers: { "x-folder": folder, "x-file": file } }),
  };
}

const FAKE_TRANSCRIPT =
  "FAKE ENGINE. Doctor: What brings you in? Patient: I have not been sleeping well for about two weeks and I feel low. I deny any thoughts of suicide.";

function fakeEngine(): Engine {
  const saved = new Map<string, Uint8Array>();
  return {
    kind: "fake",
    status: async () => ({ ffmpeg: false, whisper_cli: false, whisper_model: false, ollama: true, models: ["fake-model"], notes_root: "(in memory)" }),
    transcribe: async () => FAKE_TRANSCRIPT,
    llm: () => async ({ prompt }) => {
      const labels = [...prompt.matchAll(/^- (.+)$/gm)].map((m) => m[1]);
      if (labels.length === 0) return "The patient reports poor sleep and low mood for about two weeks.";
      return labels.map((l, i) => (i === 0 ? `${l}: The patient reports poor sleep for about two weeks and low mood.` : `${l}: Not discussed in this recording.`)).join("\n");
    },
    readTemplate: async () => new Uint8Array(await (await fetch(templateUrl)).arrayBuffer()),
    listNotes: async (folder) => [...saved.keys()].filter((k) => k.startsWith(`${folder}/`)).map((k) => k.slice(folder.length + 1)).sort(),
    readNote: async (folder, file) => saved.get(`${folder}/${file}`) ?? new Uint8Array(),
    saveNote: async (folder, file, data) => {
      if (saved.has(`${folder}/${file}`)) throw new Error("exists");
      saved.set(`${folder}/${file}`, data);
      return `(in memory) ${folder}/${file}`;
    },
  };
}

let cached: Promise<Engine> | null = null;
export const getEngine = (): Promise<Engine> => (cached ??= isTauri() ? nativeEngine() : Promise.resolve(fakeEngine()));
