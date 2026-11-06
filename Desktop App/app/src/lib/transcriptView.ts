/**
 * The transcript text is `[mm:ss] Speaker: words`, one block per speaker turn (the recorder writes it, the practice app
 * stores it as is, and the notes model reads it). This module reads it back for the transcript window: blocks, time
 * buckets with headings, and renaming speakers. Pure functions, no patient data kept anywhere.
 */
export type Block = { time: string; seconds: number; speaker: string; text: string };
export type Bucket = { heading: string; blocks: Block[] };

const LINE = /^\[(\d{1,3}):(\d{2})\]\s+(?:([^:\n]{1,24}):\s+)?(.*)$/;

/** Reads the text into blocks. Lines that do not start with a time (older plain transcripts, earlier-text separators)
 *  stay as blocks with no time and no speaker so nothing is lost. */
export function parseTranscript(text: string): Block[] {
  const blocks: Block[] = [];
  for (const raw of text.split("\n")) {
    const line = raw.trimEnd();
    if (!line.trim()) continue;
    const m = LINE.exec(line);
    if (m) {
      const seconds = Number(m[1]) * 60 + Number(m[2]);
      const speaker = (m[3] ?? "").trim();
      const prev = blocks[blocks.length - 1];
      if (prev && prev.speaker === speaker && speaker && prev.time) {
        prev.text += ` ${m[4]}`;
      } else {
        blocks.push({ time: `${m[1].padStart(2, "0")}:${m[2]}`, seconds, speaker, text: m[4] });
      }
    } else {
      blocks.push({ time: "", seconds: -1, speaker: "", text: line });
    }
  }
  return blocks;
}

const mmss = (s: number) => `${String(Math.floor(s / 60)).padStart(2, "0")}:${String(s % 60).padStart(2, "0")}`;

/** Splits long recordings into time buckets ("00:00 – 05:00") so the window is easy to scan. Short ones are one bucket
 *  with no heading. Untimed lines stay with the bucket before them. */
export function bucketize(blocks: Block[], bucketSeconds = 300): Bucket[] {
  const lastTime = Math.max(0, ...blocks.map((b) => b.seconds));
  if (lastTime < bucketSeconds) return blocks.length ? [{ heading: "", blocks }] : [];
  const out: Bucket[] = [];
  let current = -1;
  for (const b of blocks) {
    const idx = b.seconds < 0 ? Math.max(current, 0) : Math.floor(b.seconds / bucketSeconds);
    if (idx !== current || !out.length) {
      current = idx;
      out.push({ heading: `${mmss(idx * bucketSeconds)} – ${mmss((idx + 1) * bucketSeconds)}`, blocks: [] });
    }
    out[out.length - 1].blocks.push(b);
  }
  return out;
}

/** The distinct speakers in order of first appearance. */
export function speakersIn(blocks: Block[]): string[] {
  return [...new Set(blocks.map((b) => b.speaker).filter(Boolean))];
}

/** True while some lines are still "Speaker 1" / "Speaker 2" (the provider has not said who is the patient). */
export const hasUnconfirmed = (blocks: Block[]): boolean => blocks.some((b) => /^Speaker \d+$/.test(b.speaker));

/** Renames speakers in the text itself, at the start of timed lines only. `map` is old label to new label; swapping two
 *  labels works because every line is renamed from the original text. */
export function relabelText(text: string, map: Record<string, string>): string {
  return text
    .split("\n")
    .map((line) => {
      const m = LINE.exec(line);
      if (!m || !m[3]) return line;
      const to = map[m[3].trim()];
      return to ? `[${m[1].padStart(2, "0")}:${m[2]}] ${to}: ${m[4]}` : line;
    })
    .join("\n");
}

/** The first words a speaker said, for the "which speaker is the patient?" choice. */
export function firstWords(blocks: Block[], speaker: string, n = 14): string {
  const b = blocks.find((x) => x.speaker === speaker);
  return b ? b.text.split(/\s+/).slice(0, n).join(" ") : "";
}

/** The label that goes with a chosen patient speaker: the patient is "Patient", the other is "Provider". */
export function patientChoice(patient: string, speakers: string[]): Record<string, string> {
  const map: Record<string, string> = {};
  for (const s of speakers) map[s] = s === patient ? "Patient" : "Provider";
  return map;
}
