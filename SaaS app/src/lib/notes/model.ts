// Talks to the note-writing model. Phase 1 points at a local server; phase 2 at the hosted endpoint on Cloud Run.
// Only the transcript text is ever sent: the recording stays on the provider's Mac.

import type { Llm } from "./types";

export type ModelConfig = { url: string; model: string; apiKey?: string };

export function modelConfig(): ModelConfig {
  return {
    url: process.env.NOTES_MODEL_URL || "http://127.0.0.1:11434",
    model: process.env.NOTES_MODEL || "qwen2.5:14b-instruct",
    apiKey: process.env.NOTES_MODEL_KEY,
  };
}

/**
 * One chat turn. The model is kept resident between calls, because a note is dozens of short prompts in a row and a
 * reload between them dominates the time.
 */
export function makeLlm(cfg = modelConfig()): Llm {
  return async ({ system, prompt }) => {
    const res = await fetch(`${cfg.url}/api/chat`, {
      method: "POST",
      headers: { "content-type": "application/json", ...(cfg.apiKey ? { authorization: `Bearer ${cfg.apiKey}` } : {}) },
      body: JSON.stringify({
        model: cfg.model,
        stream: false,
        think: false,
        keep_alive: "30m",
        options: { temperature: 0.1, num_ctx: 16384 },
        messages: [{ role: "system", content: system }, { role: "user", content: prompt }],
      }),
    });
    if (!res.ok) throw new Error(`the note-writing model returned ${res.status}`);
    const json = (await res.json()) as { error?: string; message?: { content?: string } };
    if (json.error) throw new Error("the note-writing model reported an error");
    return json.message?.content ?? "";
  };
}

/** Asks the endpoint to load the model, so the wait happens during the visit rather than after it. */
export async function warmModel(cfg = modelConfig()): Promise<boolean> {
  try {
    await makeLlm(cfg)({ system: "Reply with OK.", prompt: "OK" });
    return true;
  } catch {
    return false;
  }
}
