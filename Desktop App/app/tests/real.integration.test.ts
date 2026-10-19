// Real engines on synthetic speech. Skipped unless SPIKE_AUDIO is set. Example:
//   SPIKE_AUDIO=/path/visit.aiff SPIKE_OUT=/tmp/note.docx npx vitest run tests/real.integration.test.ts
import { describe, expect, it } from "vitest";
import { execFileSync } from "node:child_process";
import { mkdtempSync, readFileSync, writeFileSync } from "node:fs";
import { homedir, tmpdir } from "node:os";
import path from "node:path";
import { draftNote } from "../src/lib/pipeline";
import { docxText, fillTemplate } from "../src/lib/docxFill";
import type { Llm, NoteKind } from "../src/lib/types";

const audio = process.env.SPIKE_AUDIO;
const model = process.env.SPIKE_MODEL ?? "qwen2.5:7b-instruct";

const ollama: Llm = async ({ system, prompt }) => {
  const r = await fetch("http://127.0.0.1:11434/api/chat", {
    method: "POST",
    body: JSON.stringify({ model, stream: false, options: { temperature: 0.1, num_ctx: 16384 }, messages: [{ role: "system", content: system }, { role: "user", content: prompt }] }),
  });
  return (await r.json()).message.content as string;
};

describe.skipIf(!audio)("real engines", () => {
  it("transcribes, drafts and fills the template", async () => {
    const dir = mkdtempSync(path.join(tmpdir(), "spike-"));
    const wav = path.join(dir, "a.wav");
    execFileSync("/opt/homebrew/bin/ffmpeg", ["-y", "-loglevel", "error", "-i", audio!, "-ar", "16000", "-ac", "1", wav]);
    const transcript = execFileSync("/opt/homebrew/bin/whisper-cli", ["-m", path.join(homedir(), "Library/Application Support/PracticeNotesSpike/models/ggml-small.en.bin"), "-nt", "-np", "-f", wav], { encoding: "utf8" }).replace(/\s+/g, " ").trim();
    const kind = (process.env.SPIKE_KIND ?? "EVAL") as NoteKind;
    const note = await draftNote({ kind, transcript, mode: "recording", visitDate: "2026-10-19", typeLabel: "Psych Eval", providerName: "Dr. Example", patientName: "Testcase, Alpha", llm: ollama });
    const { bytes } = await fillTemplate(readFileSync(path.resolve(__dirname, "../../../Templates/Psychiatric_Master_Template_v2.docx")), note);
    const text = await docxText(bytes);
    if (process.env.SPIKE_OUT) writeFileSync(process.env.SPIKE_OUT, `TRANSCRIPT:\n${transcript}\n\n${text}\n\nFLAGGED:\n${note.sections.flatMap((s) => s.paragraphs.filter((p) => p.flag === "ungrounded").map((p) => `${s.heading} / ${p.label}: ${p.text}`)).join("\n")}`);
    expect(text).toContain("PSYCHIATRIC");
    expect(transcript.toLowerCase()).toContain("sleep");
  }, 600_000);
});
