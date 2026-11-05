// Talks to the note-writing model. Two backends:
//  - "vertex": Gemini on Vertex AI inside our own GCP project (covered by the Google Cloud BAA). Used on Cloud Run.
//  - "ollama": a local server, for development only.
// Only the transcript text is ever sent: the recording never leaves the provider's Mac.

import type { Llm } from "./types";

export type ModelConfig =
  | { provider: "vertex"; project: string; location: string; model: string; token?: string }
  | { provider: "ollama"; url: string; model: string; apiKey?: string }
  | { provider: "none" };

/** Thrown when no note-writing model is set up, so the UI can say so plainly instead of "fetch failed". */
export class ModelNotConfiguredError extends Error {
  constructor() {
    super("No note-writing model is set up yet. Ask the administrator to configure one.");
    this.name = "ModelNotConfiguredError";
  }
}

export function modelConfig(env: NodeJS.ProcessEnv = process.env): ModelConfig {
  const vertexProject = env.NOTES_VERTEX_PROJECT;
  if (vertexProject) {
    return {
      provider: "vertex",
      project: vertexProject,
      location: env.NOTES_VERTEX_LOCATION || "global",
      model: env.NOTES_MODEL || "gemini-3.5-flash",
      token: env.NOTES_VERTEX_TOKEN, // local testing only; on Cloud Run the service account is used
    };
  }
  if (env.NOTES_MODEL_URL) {
    return { provider: "ollama", url: env.NOTES_MODEL_URL, model: env.NOTES_MODEL || "qwen2.5:14b-instruct", apiKey: env.NOTES_MODEL_KEY };
  }
  // Nothing configured: only development falls back to a local Ollama. Production says "not configured".
  if (env.NODE_ENV !== "production") {
    return { provider: "ollama", url: "http://127.0.0.1:11434", model: env.NOTES_MODEL || "qwen2.5:14b-instruct" };
  }
  return { provider: "none" };
}

let cachedToken: { value: string; expires: number } | null = null;

/** Access token for the Cloud Run service account, from the metadata server (no extra dependency). */
async function serviceAccountToken(): Promise<string> {
  if (cachedToken && cachedToken.expires > Date.now() + 60_000) return cachedToken.value;
  const res = await fetch(
    "http://metadata.google.internal/computeMetadata/v1/instance/service-accounts/default/token",
    { headers: { "Metadata-Flavor": "Google" } },
  );
  if (!res.ok) throw new Error("could not get a Google credential for the note-writing model");
  const json = (await res.json()) as { access_token: string; expires_in: number };
  cachedToken = { value: json.access_token, expires: Date.now() + json.expires_in * 1000 };
  return json.access_token;
}

async function vertexChat(cfg: Extract<ModelConfig, { provider: "vertex" }>, system: string, prompt: string): Promise<string> {
  const token = cfg.token || (await serviceAccountToken());
  // Current Gemini models are served from the "global" endpoint; regional ones use a location prefix.
  const host = cfg.location === "global" ? "aiplatform.googleapis.com" : `${cfg.location}-aiplatform.googleapis.com`;
  const url =
    `https://${host}/v1/projects/${cfg.project}/locations/${cfg.location}` +
    `/publishers/google/models/${cfg.model}:generateContent`;
  const res = await fetch(url, {
    method: "POST",
    headers: { "content-type": "application/json", authorization: `Bearer ${token}` },
    body: JSON.stringify({
      systemInstruction: { role: "system", parts: [{ text: system }] },
      contents: [{ role: "user", parts: [{ text: prompt }] }],
      generationConfig: { temperature: 0.1 },
    }),
  });
  if (!res.ok) throw new Error(`the note-writing model returned ${res.status}`);
  const json = (await res.json()) as { candidates?: { content?: { parts?: { text?: string }[] } }[] };
  return (json.candidates?.[0]?.content?.parts ?? []).map((p) => p.text ?? "").join("");
}

async function ollamaChat(cfg: Extract<ModelConfig, { provider: "ollama" }>, system: string, prompt: string): Promise<string> {
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
}

/** One chat turn against whichever backend is configured. */
export function makeLlm(cfg: ModelConfig = modelConfig()): Llm {
  return async ({ system, prompt }) => {
    if (cfg.provider === "none") throw new ModelNotConfiguredError();
    return cfg.provider === "vertex" ? vertexChat(cfg, system, prompt) : ollamaChat(cfg, system, prompt);
  };
}

/** True when a backend is set up (says nothing about whether it is reachable). */
export function modelConfigured(cfg: ModelConfig = modelConfig()): boolean {
  return cfg.provider !== "none";
}

/** Warms the model so the wait happens during the visit. Hosted Vertex needs no warm-up. */
export async function warmModel(cfg: ModelConfig = modelConfig()): Promise<boolean> {
  if (cfg.provider === "none") return false;
  if (cfg.provider === "vertex") return true;
  try {
    await makeLlm(cfg)({ system: "Reply with OK.", prompt: "OK" });
    return true;
  } catch {
    return false;
  }
}
