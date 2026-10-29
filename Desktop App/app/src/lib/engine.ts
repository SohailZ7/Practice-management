// The app's bridge to the native side. Inside the Tauri window it calls the Rust commands (src-tauri/src/lib.rs).
// In a plain browser (npm run dev, used for UI work) it uses clearly labelled fake engines, so the screens can be
// exercised without a microphone, Whisper or a language model.

import type { Llm } from "./types";
import type { DocSpec } from "./documents";
import masterUrl from "../../../../Templates/Psychiatric_Master_Template_v2.docx?url";
import progressUrl from "../../../../Templates/forms/Psychiatrist_Progress_Note_v1.docx?url";
import dischargeUrl from "../../../../Templates/forms/Physician_Discharge_Order_v1.docx?url";
import admitUrl from "../../../../Templates/forms/Admit_Outpatient_Program_Order_v1.docx?url";

export type Settings = {
  master_folder: string;
  provider_name: string;
  model: string;
  whisper_model: string;
  templates_dir: string;
  ollama_url: string;
};

export type EngineStatus = {
  ffmpeg: boolean;
  whisper_cli: boolean;
  whisper_model: boolean;
  models: string[];
  settings: Settings;
};

export type VisitFile = { name: string; path: string; draft: boolean };

export interface Engine {
  readonly kind: "native" | "fake";
  status(): Promise<EngineStatus>;
  getSettings(): Promise<Settings>;
  setSettings(s: Settings): Promise<Settings>;
  transcribe(audio: Uint8Array, ext: string): Promise<string>;
  llm(model: string): Llm;
  template(name: DocSpec["template"]): Promise<Uint8Array>;
  visitFiles(folder: string, date: string): Promise<VisitFile[]>;
  readVisitFile(folder: string, date: string, file: string): Promise<Uint8Array>;
  priorNote(folder: string, before: string): Promise<{ date: string; file: string } | null>;
  saveVisitFile(folder: string, date: string, file: string, bytes: Uint8Array): Promise<string>;
  markReviewed(folder: string, date: string, file: string): Promise<string>;
  saveSchedule(date: string, json: string): Promise<void>;
  loadSchedule(date: string): Promise<string | null>;
  reveal(path: string): Promise<void>;
  openFile(path: string): Promise<void>;
}

const isTauri = () => typeof window !== "undefined" && "__TAURI_INTERNALS__" in window;

const TEMPLATE_URLS: Record<DocSpec["template"], string> = {
  master: masterUrl,
  progress: progressUrl,
  discharge: dischargeUrl,
  admit: admitUrl,
};

async function nativeEngine(): Promise<Engine> {
  const { invoke } = await import("@tauri-apps/api/core");
  const bytes = (b: ArrayBuffer) => new Uint8Array(b);
  return {
    kind: "native",
    status: () => invoke<EngineStatus>("engine_status_cmd"),
    getSettings: () => invoke<Settings>("get_settings"),
    setSettings: (settings) => invoke<Settings>("set_settings", { settings }),
    transcribe: (audio, ext) => invoke<string>("transcribe", audio, { headers: { "x-ext": ext } }),
    llm: (model) => ({ system, prompt }) => invoke<string>("llm_complete", { model, system, prompt }),
    template: async (name) => bytes(await invoke<ArrayBuffer>("read_template", { name })),
    visitFiles: (folder, date) => invoke<VisitFile[]>("visit_files", { folder, date }),
    readVisitFile: async (folder, date, file) => bytes(await invoke<ArrayBuffer>("read_visit_file", { folder, date, file })),
    priorNote: (folder, before) => invoke<{ date: string; file: string } | null>("prior_note", { folder, before }),
    saveVisitFile: (folder, date, file, data) =>
      invoke<string>("save_visit_file", data, { headers: { "x-folder": folder, "x-date": date, "x-file": file } }),
    markReviewed: (folder, date, file) => invoke<string>("mark_reviewed", { folder, date, file }),
    saveSchedule: (date, json) => invoke<void>("save_schedule", { date, json }),
    loadSchedule: (date) => invoke<string | null>("load_schedule", { date }),
    reveal: (path) => invoke<void>("reveal", { path }),
    openFile: (path) => invoke<void>("open_file", { path }),
  };
}

const FAKE_TRANSCRIPT =
  "FAKE ENGINE, nothing was recorded. Doctor: how have you been? Patient: I have not been sleeping well for about two " +
  "weeks and I feel low most days. I deny any thoughts of suicide. Doctor: I will continue the sertraline fifty " +
  "milligrams and see you in two weeks.";

function fakeEngine(): Engine {
  const files = new Map<string, Uint8Array>();
  const schedules = new Map<string, string>();
  let settings: Settings = {
    master_folder: "(in memory)",
    provider_name: "Dr. Khalid Ahmed",
    model: "fake-model",
    whisper_model: "(none)",
    templates_dir: "(bundled)",
    ollama_url: "",
  };
  const key = (f: string, d: string, n: string) => `${f}/${d}/${n}`;

  return {
    kind: "fake",
    status: async () => ({ ffmpeg: false, whisper_cli: false, whisper_model: false, models: ["fake-model"], settings }),
    getSettings: async () => settings,
    setSettings: async (s) => ((settings = s), s),
    transcribe: async () => FAKE_TRANSCRIPT,
    llm: () => async ({ prompt }) => {
      if (prompt.includes("OPTIONS:")) {
        const first = /^- (.+)$/m.exec(prompt)?.[1];
        return first ? `CHOOSE: ${first}\nTEXT: NONE` : "CHOOSE: NONE\nTEXT: a short phrase";
      }
      if (prompt.includes("QUESTION:")) return "ANSWER: NOT_ASKED\nSTATEMENT:\nQUOTE:";
      const labels = [...prompt.matchAll(/^- (.+)$/gm)].map((m) => m[1]);
      if (!labels.length) return "The patient reports poor sleep and low mood for about two weeks.";
      return labels
        .map((l, i) => `${l}: ${i === 0 ? "The patient reports poor sleep for about two weeks." : "Not discussed in this recording."}`)
        .join("\n");
    },
    template: async (name) => new Uint8Array(await (await fetch(TEMPLATE_URLS[name])).arrayBuffer()),
    visitFiles: async (folder, date) =>
      [...files.keys()]
        .filter((k) => k.startsWith(`${folder}/${date}/`))
        .map((k) => k.split("/").pop()!)
        .sort()
        .map((name) => ({ name, path: `(in memory) ${folder}/${date}/${name}`, draft: name.includes("DRAFT") })),
    readVisitFile: async (folder, date, file) => files.get(key(folder, date, file)) ?? new Uint8Array(),
    priorNote: async () => null,
    saveVisitFile: async (folder, date, file, data) => {
      if (files.has(key(folder, date, file))) throw new Error("exists");
      files.set(key(folder, date, file), data);
      return `(in memory) ${folder}/${date}/${file}`;
    },
    markReviewed: async (folder, date, file) => {
      const data = files.get(key(folder, date, file));
      const next = file.replace(" DRAFT", "");
      if (data) {
        files.delete(key(folder, date, file));
        files.set(key(folder, date, next), data);
      }
      return `(in memory) ${folder}/${date}/${next}`;
    },
    saveSchedule: async (date, json) => void schedules.set(date, json),
    loadSchedule: async (date) => schedules.get(date) ?? null,
    reveal: async () => alert("Finder is only available in the real app."),
    openFile: async () => alert("Opening files is only available in the real app."),
  };
}

let cached: Promise<Engine> | null = null;
export const getEngine = (): Promise<Engine> => (cached ??= isTauri() ? nativeEngine() : Promise.resolve(fakeEngine()));
