import { afterEach, describe, expect, it, vi } from "vitest";
import { ModelNotConfiguredError, makeLlm, modelConfig, modelConfigured, warmModel } from "../src/lib/notes/model";

afterEach(() => vi.unstubAllGlobals());

describe("modelConfig", () => {
  it("is not configured in production with nothing set", () => {
    const cfg = modelConfig({ NODE_ENV: "production" } as NodeJS.ProcessEnv);
    expect(cfg.provider).toBe("none");
    expect(modelConfigured(cfg)).toBe(false);
  });
  it("falls back to local Ollama only outside production", () => {
    expect(modelConfig({ NODE_ENV: "development" } as NodeJS.ProcessEnv).provider).toBe("ollama");
  });
  it("prefers Vertex when a project is set", () => {
    const cfg = modelConfig({ NODE_ENV: "production", NOTES_VERTEX_PROJECT: "p" } as NodeJS.ProcessEnv);
    expect(cfg).toMatchObject({ provider: "vertex", project: "p", location: "global", model: "gemini-3.5-flash" });
  });
});

describe("makeLlm", () => {
  it("throws a readable error when not configured", async () => {
    await expect(makeLlm({ provider: "none" })({ system: "s", prompt: "p" })).rejects.toBeInstanceOf(ModelNotConfiguredError);
    expect(await warmModel({ provider: "none" })).toBe(false);
  });
  it("calls Vertex generateContent and joins the text parts", async () => {
    const fetchMock = vi.fn().mockResolvedValue({
      ok: true,
      json: async () => ({ candidates: [{ content: { parts: [{ text: "Hello " }, { text: "world" }] } }] }),
    });
    vi.stubGlobal("fetch", fetchMock);
    const llm = makeLlm({ provider: "vertex", project: "proj", location: "us-central1", model: "gemini-2.5-flash", token: "tok" });
    expect(await llm({ system: "sys", prompt: "hi" })).toBe("Hello world");
    const [url, init] = fetchMock.mock.calls[0];
    expect(url).toContain("us-central1-aiplatform.googleapis.com/v1/projects/proj/locations/us-central1");
    expect(url).toContain("gemini-2.5-flash:generateContent");
    await makeLlm({ provider: "vertex", project: "proj", location: "global", model: "m", token: "tok" })({ system: "s", prompt: "p" });
    expect(fetchMock.mock.calls[1][0]).toContain("https://aiplatform.googleapis.com/v1/projects/proj/locations/global");
    expect((init as RequestInit).headers).toMatchObject({ authorization: "Bearer tok" });
  });
  it("reports an HTTP failure without leaking the body", async () => {
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue({ ok: false, status: 403, json: async () => ({}) }));
    const llm = makeLlm({ provider: "vertex", project: "p", location: "l", model: "m", token: "t" });
    await expect(llm({ system: "s", prompt: "p" })).rejects.toThrow("returned 403");
  });
});
