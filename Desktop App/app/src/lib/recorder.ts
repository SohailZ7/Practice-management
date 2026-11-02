// Microphone capture in the webview. Audio stays in memory until it is handed to the native transcriber, which writes it
// to a private temp file and shreds it afterwards (desktop spec REC-2).
import type { Recording } from "./types";

export type Recorder = { stop(): Promise<Recording>; cancel(): void };

const TYPES: [string, string][] = [
  ["audio/mp4", "m4a"],
  ["audio/webm;codecs=opus", "webm"],
  ["audio/webm", "webm"],
];

export async function startRecording(): Promise<Recorder> {
  const stream = await navigator.mediaDevices.getUserMedia({ audio: true });
  const pick = TYPES.find(([t]) => typeof MediaRecorder !== "undefined" && MediaRecorder.isTypeSupported(t));
  const rec = new MediaRecorder(stream, pick ? { mimeType: pick[0] } : undefined);
  const chunks: Blob[] = [];
  rec.ondataavailable = (e) => e.data.size && chunks.push(e.data);
  const done = new Promise<void>((res) => (rec.onstop = () => res()));
  const release = () => stream.getTracks().forEach((t) => t.stop());
  rec.start(1000);
  return {
    async stop() {
      rec.stop();
      await done;
      release();
      const blob = new Blob(chunks, { type: rec.mimeType });
      return { bytes: new Uint8Array(await blob.arrayBuffer()), ext: pick?.[1] ?? "webm" };
    },
    cancel() {
      try { rec.stop(); } catch { /* already stopped */ }
      release();
      chunks.length = 0;
    },
  };
}

/** For testing without a microphone: an audio file chosen by the user becomes the "recording". */
export async function recordingFromFile(file: File): Promise<Recording> {
  const ext = (file.name.split(".").pop() ?? "bin").toLowerCase().replace(/[^a-z0-9]/g, "").slice(0, 5) || "bin";
  return { bytes: new Uint8Array(await file.arrayBuffer()), ext };
}
