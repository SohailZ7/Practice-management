import { describe, expect, it, vi } from "vitest";
import * as api from "../src/lib/api";
import { isOtherEnvironment, retryAll, uploadQueued, OTHER_ENV_MESSAGE } from "../src/lib/queue";
import type { Engine, QueueItem } from "../src/lib/engine";

// Queues written by v1.0.19 / v1.0.20 can hold items recorded against staging or localhost. FAKE ids only.
const make = (environment: QueueItem["environment"], id: string): QueueItem => ({ visit_id: id, environment, created_at: "2026-11-11T15:00:00Z", duration_seconds: 8, status: "pending" });

function engine(items: QueueItem[]) {
  const calls: string[] = [];
  const e = {
    queueList: async () => items,
    queueText: async (id: string) => { calls.push("text:" + id); return "made-up test line"; },
    queueComplete: async (id: string) => { calls.push("complete:" + id); },
    queueDiscard: async (id: string) => { calls.push("discard:" + id); },
    saveTranscriptCopy: async () => false,
    accessToken: async () => "tok",
    refreshAccessToken: async () => null,
  } as unknown as Engine;
  return { e, calls };
}

describe("an old queue after the update to the Production-only app", () => {
  it("a staging or localhost item is never sent anywhere, never completed and never discarded, and says why", async () => {
    const push = vi.spyOn(api, "pushTranscript").mockResolvedValue({ ok: true });
    const items = [make("staging", "fake-stg"), make("localhost", "fake-loc")];
    const { e, calls } = engine(items);
    const out = await retryAll(e);
    expect(out.every((r) => !r.ok && r.failure?.kind === "other_env" && r.reason === OTHER_ENV_MESSAGE)).toBe(true);
    expect(push).not.toHaveBeenCalled();
    expect(calls).toEqual([]);
    expect(items.every(isOtherEnvironment)).toBe(true);
    push.mockRestore();
  });

  it("a production item in the same queue still uploads to Production and completes only after the server confirms", async () => {
    const push = vi.spyOn(api, "pushTranscript").mockResolvedValue({ ok: true });
    const { e, calls } = engine([make("staging", "fake-stg"), make("production", "fake-prod")]);
    const [stg, prod] = await retryAll(e);
    expect(stg.ok).toBe(false);
    expect(prod.ok).toBe(true);
    expect(push).toHaveBeenCalledOnce();
    expect(push.mock.calls[0][0].baseUrl).toBe("https://practice-mgmt-802176721153.us-east4.run.app");
    expect(push.mock.calls[0][1]).toBe("fake-prod");
    expect(calls).toEqual(["text:fake-prod", "complete:fake-prod"]);
    push.mockRestore();
  });

  it("a 404 from Production says the visit is not in the Production app and keeps the copy", async () => {
    const push = vi.spyOn(api, "pushTranscript").mockRejectedValue(new api.ApiFailure(404, "not_found"));
    const { e, calls } = engine([make("production", "fake-prod")]);
    const r = await uploadQueued(e, make("production", "fake-prod"));
    expect(r.failure?.message).toBe("This visit is not in the Production app. Add it on the Production website.");
    expect(calls.some((c) => c.startsWith("complete:") || c.startsWith("discard:"))).toBe(false);
    push.mockRestore();
  });
});
