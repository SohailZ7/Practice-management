// Reads a stored transcript (`[mm:ss] Speaker: words`, the recorder's format) into speaker turns for display. Pure and
// read-only: the stored text is never changed. Lines that are not in that format stay as plain blocks, so older
// transcripts render too. Mirrors Desktop's transcriptView.ts.
export type Turn = { time: string; seconds: number; speaker: string; text: string };

const LINE = /^\[(\d{1,3}):(\d{2})\]\s+(?:([^:\n]{1,24}):\s+)?(.*)$/;

export function parseTurns(text: string): Turn[] {
  const turns: Turn[] = [];
  for (const raw of text.split("\n")) {
    const line = raw.trimEnd();
    if (!line.trim()) continue;
    const m = LINE.exec(line);
    if (!m) { turns.push({ time: "", seconds: -1, speaker: "", text: line }); continue; }
    const speaker = (m[3] ?? "").trim();
    const prev = turns[turns.length - 1];
    if (prev && speaker && prev.speaker === speaker && prev.time) prev.text += ` ${m[4]}`;
    else turns.push({ time: `${m[1].padStart(2, "0")}:${m[2]}`, seconds: Number(m[1]) * 60 + Number(m[2]), speaker, text: m[4] });
  }
  return turns;
}

/** True when at least one turn carries a speaker, i.e. the labelled view is worth showing. */
export const hasSpeakers = (turns: Turn[]) => turns.some((t) => t.speaker);

/** Role colour class for a speaker name: provider, patient, or other. */
export function speakerRole(name: string): "provider" | "patient" | "other" {
  const n = name.toLowerCase();
  if (n.startsWith("provider") || n.startsWith("clinician") || n.startsWith("doctor")) return "provider";
  if (n.startsWith("patient") || n.startsWith("client")) return "patient";
  return "other";
}
