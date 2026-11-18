import { describe, expect, it, vi } from "vitest";
import * as api from "../src/lib/api";
import { retryAll, uploadQueued } from "../src/lib/queue";
import { urlFor } from "../src/lib/environments";
import type { Engine, QueueItem } from "../src/lib/engine";

// A queue written by the previous build (v1.0.19) has this shape. FAKE transcript only.
const item: QueueItem = { visit_id: "fake-visit-1019", environment: "production", created_at: "2026-11-11T15:00:00Z", duration_seconds: 8, status: "pending" };

function engine(over: Partial<Engine> = {}) {
  const calls: string[] = [];
  const e = {
    queueList: async () => [item],
    queueText: async (id: string) => { calls.push("text:" + id); return "made-up test line"; },
    queueComplete: async (id: string) => { calls.push("complete:" + id); },
    saveTranscriptCopy: async () => { calls.push("copy"); },
    accessToken: async (env: string) => (env === "production" ? "tok" : null),
    refreshAccessToken: async () => null,
    ...over,
  } as unknown as Engine;
  return { e, calls };
}

describe("queued data survives an app update", () => {
  it("lists the old item and retries it against the environment saved with it, deleting only after the server confirms", async () => {
    const push = vi.spyOn(api, "pushTranscript").mockResolvedValue({ ok: true });
    const { e, calls } = engine();
    const [r] = await retryAll(e);
    expect(r.ok).toBe(true);
    expect(push).toHaveBeenCalledOnce();
    const [session, visitId, text] = push.mock.calls[0];
    expect(session.baseUrl).toBe(urlFor("production"));
    expect(visitId).toBe("fake-visit-1019");
    expect(text).toBe("made-up test line");
    expect(calls.indexOf("complete:fake-visit-1019")).toBeGreaterThan(calls.indexOf("text:fake-visit-1019"));
    push.mockRestore();
  });

  it("keeps the saved copy (never completes/deletes) when the upload fails", async () => {
    const push = vi.spyOn(api, "pushTranscript").mockRejectedValue(new api.ApiFailure(404, "not_found"));
    const { e, calls } = engine();
    const [r] = await retryAll(e);
    expect(r.ok).toBe(false);
    expect(calls.some((c) => c.startsWith("complete:"))).toBe(false);
    push.mockRestore();
  });

  it("keeps the saved copy when not signed in, without calling the server", async () => {
    const push = vi.spyOn(api, "pushTranscript").mockResolvedValue({ ok: true });
    const { e, calls } = engine({ accessToken: async () => null } as Partial<Engine>);
    const r = await uploadQueued(e, item);
    expect(r.ok).toBe(false);
    expect(r.failure?.kind).toBe("signed_out");
    expect(push).not.toHaveBeenCalled();
    expect(calls.some((c) => c.startsWith("complete:"))).toBe(false);
    push.mockRestore();
  });
});
