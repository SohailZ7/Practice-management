import { afterEach, describe, expect, it, vi } from "vitest";
import { canEditFeedback, checkFeedback, cleanupPrompt, parseCleanup, toFeedbackOut, MAX_DESCRIPTION, MAX_TITLE } from "../src/lib/feedback/rules";
import { ruleFor } from "../src/lib/security/rateLimit";

describe("checkFeedback", () => {
  it("accepts the two categories", () => {
    for (const kind of ["FEEDBACK", "BUG"]) {
      const r = checkFeedback({ kind, title: "  Slow page ", description: "It takes a while" }, "create");
      expect(r).toEqual({ ok: true, value: { kind, title: "Slow page", description: "It takes a while" } });
    }
  });
  it("rejects any other category, a missing title and over-long text", () => {
    expect(checkFeedback({ kind: "IDEA", title: "x" }, "create").ok).toBe(false);
    expect(checkFeedback({ kind: "BUG", title: "  " }, "create").ok).toBe(false);
    expect(checkFeedback({ kind: "BUG", title: "x".repeat(MAX_TITLE + 1) }, "create").ok).toBe(false);
    expect(checkFeedback({ kind: "BUG", title: "x", description: "y".repeat(MAX_DESCRIPTION + 1) }, "create").ok).toBe(false);
  });
  it("update takes only the fields sent and ignores unknown keys", () => {
    expect(checkFeedback({ title: "New", authorId: "someone-else" }, "update")).toEqual({ ok: true, value: { title: "New" } });
  });
  it("refuses text that looks like patient information, naming only the kind", () => {
    const r = checkFeedback({ kind: "BUG", title: "Crash", description: "Patient MRN 9988776 crashed it" }, "create");
    expect(r.ok).toBe(false);
    if (!r.ok) {
      expect(r.phi).toEqual(["mrn"]);
      expect(r.error).not.toContain("9988776");
    }
  });
});

describe("who may edit", () => {
  it("only the author", () => {
    expect(canEditFeedback("u1", "u1")).toBe(true);
    expect(canEditFeedback("admin", "u1")).toBe(false);
  });
  it("marks mine on output", () => {
    const row = { id: "f1", kind: "BUG", title: "t", description: "d", authorId: "u1", createdAt: new Date("2026-11-05T10:00:00Z"), updatedAt: new Date("2026-11-05T10:00:00Z"), author: { name: "Pat" } };
    expect(toFeedbackOut(row, "u1").mine).toBe(true);
    expect(toFeedbackOut(row, "u2")).toMatchObject({ mine: false, authorName: "Pat", kind: "BUG" });
  });
});

describe("parseCleanup", () => {
  it("reads plain and fenced JSON", () => {
    expect(parseCleanup('{"title":"Slow save","description":"Saving takes long."}')).toEqual({ title: "Slow save", description: "Saving takes long." });
    expect(parseCleanup('Here you go:\n```json\n{"title":"A","description":"B"}\n```')).toEqual({ title: "A", description: "B" });
  });
  it("returns null when unusable", () => {
    expect(parseCleanup("no json")).toBeNull();
    expect(parseCleanup('{"title":"","description":"x"}')).toBeNull();
    expect(parseCleanup("{bad json}")).toBeNull();
  });
  it("puts the transcript in the prompt", () => expect(cleanupPrompt("um the button")).toContain("um the button"));
});

describe("rate limit rule", () => {
  it("the model endpoint has its own tighter rule", () => {
    expect(ruleFor("POST", "/api/desktop/v1/feedback/cleanup", false)?.name).toBe("feedback-cleanup");
    expect(ruleFor("GET", "/api/desktop/v1/feedback", false)?.name).toBe("desktop");
  });
});

describe("cleanup endpoint", () => {
  afterEach(() => vi.restoreAllMocks());
  async function load(llm: () => Promise<string>) {
    vi.resetModules();
    vi.doMock("../src/lib/desktop/api", async () => {
      const real = await vi.importActual<typeof import("../src/lib/desktop/api")>("../src/lib/desktop/api");
      return { ...real, authenticate: async () => ({ user: { id: "u1" } }) };
    });
    vi.doMock("../src/lib/notes/model", async () => {
      const real = await vi.importActual<typeof import("../src/lib/notes/model")>("../src/lib/notes/model");
      return { ...real, makeLlm: () => llm };
    });
    return (await import("../src/app/api/desktop/v1/feedback/cleanup/route")).POST;
  }
  const post = (body: unknown) => new Request("http://x/api/desktop/v1/feedback/cleanup", { method: "POST", body: JSON.stringify(body) });

  it("returns a title and description and logs nothing", async () => {
    const log = vi.spyOn(console, "error").mockImplementation(() => undefined);
    const info = vi.spyOn(console, "log").mockImplementation(() => undefined);
    const POST = await load(async () => '{"title":"Add dark mode","description":"They would like a dark mode."}');
    const res = await POST(post({ transcript: "um so I would like like a dark mode" }));
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({ title: "Add dark mode", description: "They would like a dark mode.", possiblePhi: [] });
    expect(log).not.toHaveBeenCalled();
    expect(info).not.toHaveBeenCalled();
  });
  it("flags patient information that survives the clean-up", async () => {
    const POST = await load(async () => '{"title":"Crash","description":"Happens for MRN 9988776."}');
    const res = await POST(post({ transcript: "it crashed" }));
    expect((await res.json()).possiblePhi).toEqual(["mrn"]);
  });
  it("rejects an empty or oversized transcript", async () => {
    const POST = await load(async () => "{}");
    expect((await POST(post({ transcript: " " }))).status).toBe(400);
    expect((await POST(post({ transcript: "x".repeat(20001) }))).status).toBe(413);
  });
  it("says so plainly when no model is set up, without echoing the transcript", async () => {
    const log = vi.spyOn(console, "error").mockImplementation(() => undefined);
    let POST: Awaited<ReturnType<typeof load>>;
    // The error class must come from the same module registry the route loads, or instanceof fails.
    POST = await load(async () => {
      const { ModelNotConfiguredError } = await import("../src/lib/notes/model");
      throw new ModelNotConfiguredError();
    });
    const res = await POST(post({ transcript: "secret words" }));
    expect(res.status).toBe(503);
    expect(JSON.stringify(await res.json())).not.toContain("secret");
    expect(log).not.toHaveBeenCalled();
  });
  it("a model failure is a 502 with no text from the transcript or the error", async () => {
    const log = vi.spyOn(console, "error").mockImplementation(() => undefined);
    const POST = await load(async () => { throw new Error("boom secret words"); });
    const res = await POST(post({ transcript: "secret words" }));
    expect(res.status).toBe(502);
    expect(JSON.stringify(await res.json())).not.toContain("secret");
    expect(log).not.toHaveBeenCalled();
  });
});
