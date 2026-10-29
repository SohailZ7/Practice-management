// Small text helpers shared by the drafting pipeline and the safety passes. No imports, so there is no import cycle.

/**
 * Some models ("thinking" models such as Qwen3 and gpt-oss) emit their reasoning before the answer, either in tags or
 * after a "Final answer:" marker. None of it belongs in a clinical note, so it is stripped before parsing.
 */
export function stripThinking(text: string): string {
  let out = text;
  for (const tag of ["think", "thinking", "reasoning", "analysis", "scratchpad"]) {
    out = out.replace(new RegExp(`<${tag}\\b[^>]*>[\\s\\S]*?</${tag}>`, "gi"), "");
    // An unclosed opening tag means the reply was cut off mid-thought: drop everything after it.
    out = out.replace(new RegExp(`<${tag}\\b[^>]*>[\\s\\S]*$`, "i"), "");
  }
  const marker = /(?:^|\n)\s*(?:final answer|final|answer)\s*:?\s*\n/i.exec(out);
  if (marker && marker.index > 0) out = out.slice(marker.index + marker[0].length);
  return out.trim();
}
